import { grpcCall } from "./call.js";
import { resolveMethod, type ResolvedMethod } from "./descriptor.js";
import {
  describeFromCatalog,
  discoverFromCatalog,
  type DescribeOptions,
  type DiscoveryResult,
  type MethodDetail,
} from "./discovery.js";
import { buildCatalog, type Catalog } from "./catalog.js";
import type {
  GrpcEndpoint,
  GrpcResult,
  GrpcSendOptions,
  GrpcTarget,
} from "./types.js";

export interface GrpcPlan {
  collection: unknown;
  environment: unknown;
  warnings: string[];
  streaming: boolean;
}

interface CachedCatalog {
  catalog: Catalog;
  packageDefinition: Record<string, unknown>;
  at: number;
}

/**
 * Fingerprints TLS config without embedding certificate bytes in a cache key.
 *
 * JSON.stringify would expand a Buffer into {"type":"Buffer","data":[...]},
 * making the key hundreds of kilobytes under mTLS and re-serialising it on
 * every lookup. Lengths suffice: what the cached descriptors depend on is which
 * server was reached, and that is covered by `address`.
 */
function tlsKey(tls: GrpcEndpoint["tls"]): unknown {
  if (tls === undefined || tls === false) return false;
  if (tls === true) return "system";
  return {
    roots: tls.rootCerts?.length ?? 0,
    key: tls.privateKey?.length ?? 0,
    chain: tls.certChain?.length ?? 0,
    skipHostname: tls.skipHostnameVerification === true,
  };
}

/**
 * Cache key for one descriptor source.
 *
 * Deliberately excludes service and method: every method on an endpoint shares
 * one catalog, and keying per method would re-dial the server for every click
 * in a UI.
 */
function sourceKey(endpoint: GrpcEndpoint): string {
  if (endpoint.reflection === true) {
    return JSON.stringify({
      kind: "reflection",
      address: endpoint.address,
      version: endpoint.reflectionVersion ?? null,
      host: endpoint.reflectionHost ?? null,
      tls: tlsKey(endpoint.tls),
    });
  }
  return JSON.stringify({
    kind: "proto",
    address: endpoint.address,
    // Sorted: two callers naming the same tree in a different order must share
    // one catalog, otherwise the cache silently doubles the work.
    protoPaths: [...endpoint.protoPaths].sort(),
    includeDirs: [...(endpoint.includeDirs ?? [])].sort(),
    ignoreDirs: [...(endpoint.ignoreDirs ?? [])].sort(),
    followSymlinks: endpoint.followSymlinks === true,
    tls: tlsKey(endpoint.tls),
  });
}

/**
 * Shape used only to inspect untrusted input.
 *
 * Deliberately not Partial<GrpcTarget>: GrpcTarget is a union, so Partial
 * distributes over it and no branch carries every field a validator needs to
 * probe. A validator must be able to look at fields that are absent, which is
 * the opposite of what the public type is for.
 */
interface TargetProbe {
  address?: unknown;
  service?: unknown;
  method?: unknown;
  reflection?: unknown;
  protoPaths?: unknown;
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export interface GrpcAdapterOptions {
  /**
   * How long a catalog may be reused, in ms. Default 30_000.
   *
   * A server can be redeployed with a different schema, so this is a staleness
   * budget rather than a permanent cache; 0 disables reuse entirely.
   */
  catalogTtlMs?: number;
}

export class GrpcAdapter {
  readonly protocol = "grpc" as const;

  private readonly catalogTtlMs: number;
  private readonly catalogs = new Map<string, CachedCatalog>();
  /** In-flight builds, so concurrent first calls dial once. */
  private readonly building = new Map<string, Promise<CachedCatalog>>();

  constructor(options: GrpcAdapterOptions = {}) {
    this.catalogTtlMs = options.catalogTtlMs ?? 30_000;
  }

  /**
   * True only for targets this adapter can actually process. One without a
   * descriptor source is rejected here rather than accepted and then failed in
   * plan(), because claiming support for something that always throws makes the
   * dispatcher's decision meaningless.
   */
  supports(target: unknown): boolean {
    if (!target || typeof target !== "object") return false;
    const t = target as TargetProbe;
    if (
      !nonEmptyString(t.address) ||
      !nonEmptyString(t.service) ||
      !nonEmptyString(t.method)
    ) {
      return false;
    }
    if (t.reflection === true) return true;
    return Array.isArray(t.protoPaths) && t.protoPaths.length > 0;
  }

  private assertSupported(target: unknown): GrpcTarget {
    if (!this.supports(target)) {
      throw new Error(
        "not a usable gRPC target: address, service and method are required, " +
          "plus either protoPaths (files or directories) or reflection: true.",
      );
    }
    return target as GrpcTarget;
  }

  /** Builds or reuses the catalog for an endpoint. */
  async catalogFor(endpoint: GrpcEndpoint): Promise<CachedCatalog> {
    const key = sourceKey(endpoint);

    if (this.catalogTtlMs > 0) {
      const hit = this.catalogs.get(key);
      if (hit && Date.now() - hit.at <= this.catalogTtlMs) return hit;
      const pending = this.building.get(key);
      if (pending) return pending;
    }

    const build = buildCatalog(endpoint)
      .then(({ catalog, packageDefinition }) => {
        const entry: CachedCatalog = {
          catalog,
          packageDefinition,
          at: Date.now(),
        };
        if (this.catalogTtlMs > 0) this.catalogs.set(key, entry);
        return entry;
      })
      .finally(() => {
        // Only successes are cached above, so a failed build leaves no entry
        // and the next call retries rather than replaying a stale error.
        this.building.delete(key);
      });

    if (this.catalogTtlMs > 0) this.building.set(key, build);
    return build;
  }

  /** Drops cached descriptors, for when the server or the proto tree changed. */
  invalidate(endpoint?: GrpcEndpoint): void {
    if (!endpoint) {
      this.catalogs.clear();
      return;
    }
    this.catalogs.delete(sourceKey(endpoint));
  }

  /**
   * Produces an export bundle for one method.
   *
   * Unlike the HTTP adapter this performs I/O — reading the proto tree, or
   * dialling the server when reflection is the source — because a gRPC method's
   * streaming kind and message shapes exist nowhere else.
   */
  async plan(target: unknown): Promise<GrpcPlan> {
    const t = this.assertSupported(target);
    const { catalog, packageDefinition } = await this.catalogFor(t);
    const method = await resolveMethod(t, { catalog, packageDefinition });

    const warnings = [
      ...method.notes,
      "the exported collection is not a valid Postman v2.1.0 document: gRPC " +
        'has no standard representation there, so method is written as "GRPC" ' +
        "and the invocation details live under protocolProfileBehavior. " +
        "Import support depends on the client.",
      "only address, service, method and metadata survive the export. Message " +
        "payloads, stream pacing, deadlines and truncation limits do not.",
      "gRPC results cannot be written back into an OpenAPI document; " +
        "writeBack is ignored for protocol=grpc.",
      ...describeTlsExport(t),
    ];

    return {
      streaming: method.requestStream || method.responseStream,
      warnings,
      environment: { baseUrl: t.address },
      collection: buildCollection(t, method),
    };
  }

  async run(target: unknown, options?: unknown): Promise<GrpcResult> {
    const t = this.assertSupported(target);
    return grpcCall(t, (options ?? {}) as GrpcSendOptions);
  }

  /** Not part of ProtocolAdapter; exposed for discovery UIs. */
  async discover(endpoint: GrpcEndpoint): Promise<DiscoveryResult> {
    const { catalog, packageDefinition } = await this.catalogFor(endpoint);
    return discoverFromCatalog(endpoint, catalog, packageDefinition);
  }

  async describeMethod(
    endpoint: GrpcEndpoint,
    service: string,
    method: string,
    options: DescribeOptions = {},
  ): Promise<MethodDetail> {
    const { catalog, packageDefinition } = await this.catalogFor(endpoint);
    return describeFromCatalog(catalog, packageDefinition, service, method, {
      includeResponse: true,
      ...options,
    });
  }
}

/** Reports what the TLS configuration loses on the way out. */
function describeTlsExport(target: GrpcTarget): string[] {
  const tls = target.tls;
  if (tls === undefined || tls === false || tls === true) return [];
  const lost: string[] = [];
  if (tls.privateKey || tls.certChain) lost.push("the client certificate");
  if (tls.rootCerts) lost.push("the custom CA bundle");
  if (tls.skipHostnameVerification) {
    lost.push(
      "skipHostnameVerification, which the importing client will not honour",
    );
  }
  if (lost.length === 0) return [];
  return [
    `the export records only that TLS is enabled; ${lost.join(" and ")} ` +
      `will be absent, so the imported request will not connect as configured.`,
  ];
}

function buildCollection(target: GrpcTarget, method: ResolvedMethod): unknown {
  const name = `${target.service}/${target.method}`;
  return {
    info: {
      name,
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [
      {
        name,
        request: {
          method: "GRPC",
          url: { raw: `grpc://${target.address}${method.path}` },
          description: `kind=${method.kind} source=${method.source}`,
          // flatMap, not map: a repeated metadata key must become repeated
          // headers, since joining them with ", " changes the value.
          header: Object.entries(target.metadata ?? {}).flatMap(
            ([key, value]) =>
              (Array.isArray(value) ? value : [value]).map((v) => ({
                key,
                value: v,
              })),
          ),
        },
        protocolProfileBehavior: {
          grpc: {
            service: target.service,
            methodName: method.name ?? target.method,
            methodType: method.kind,
            url: target.address,
            tls: target.tls !== undefined && target.tls !== false,
          },
        },
      },
    ],
  };
}
