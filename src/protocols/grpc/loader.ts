type GrpcJs = typeof import("@grpc/grpc-js");
type ProtoLoader = typeof import("@grpc/proto-loader");

export interface LoadedGrpc {
  grpc: GrpcJs;
  protoLoader: ProtoLoader;
  /** Capabilities probed once at load time, so call sites never re-check. */
  capabilities: GrpcCapabilities;
}

export interface GrpcCapabilities {
  /** proto-loader >= 0.7. Required by reflection. */
  descriptorSetFromBuffer: boolean;
  /** Version strings when readable, for diagnostics. */
  grpcVersion?: string;
  protoLoaderVersion?: string;
}

const PACKAGES = {
  grpc: "@grpc/grpc-js",
  protoLoader: "@grpc/proto-loader",
} as const;

/**
 * The optional gRPC peer dependencies are missing.
 *
 * Distinguished from every other load failure because it is the only one the
 * user can fix with an install command; telling someone to install a package
 * they already have is worse than saying nothing.
 */
export class GrpcDependencyMissingError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[], cause?: unknown) {
    super(
      `gRPC support requires optional peer dependencies that are not installed: ` +
        `${missing.join(", ")}.\n` +
        `  npm i ${missing.join(" ")}`,
      { cause },
    );
    this.name = "GrpcDependencyMissingError";
    this.missing = missing;
  }
}

/**
 * The package is installed but unusable: it failed to evaluate, or its shape is
 * not what this library requires. Actionable in a completely different way from
 * a missing install, so it is a separate type.
 */
export class GrpcDependencyBrokenError extends Error {
  readonly packageName: string;

  constructor(packageName: string, reason: string, cause?: unknown) {
    super(
      `gRPC dependency "${packageName}" is installed but unusable: ${reason}`,
      { cause },
    );
    this.name = "GrpcDependencyBrokenError";
    this.packageName = packageName;
  }
}

/** True when the failure is "this specifier does not resolve", not "it threw". */
function isModuleNotFound(error: unknown, specifier: string): boolean {
  const e = error as { code?: unknown; message?: unknown } | undefined;
  const code = typeof e?.code === "string" ? e.code : "";
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") {
    return false;
  }
  // A transitive dependency of grpc-js can also be missing, and that is a
  // broken install rather than an absent one. Only claim "not installed" when
  // the unresolved specifier is the package we asked for.
  const message = typeof e?.message === "string" ? e.message : "";
  return message.includes(specifier);
}

/**
 * Normalises CJS/ESM interop. proto-loader and grpc-js are CommonJS; depending
 * on the loader they may arrive as a namespace with named re-exports, or with
 * everything under `default`.
 */
function unwrap<T>(namespace: unknown, probe: string, packageName: string): T {
  const candidates = [
    namespace,
    (namespace as { default?: unknown } | undefined)?.default,
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      probe in (candidate as object)
    ) {
      return candidate as T;
    }
  }
  throw new GrpcDependencyBrokenError(
    packageName,
    `its module namespace has no "${probe}" export, so the installed version ` +
      `is not the package this library expects.`,
  );
}

async function importPackage(
  specifier: string,
  probe: string,
): Promise<unknown> {
  let namespace: unknown;
  try {
    namespace = await import(specifier);
  } catch (cause) {
    if (isModuleNotFound(cause, specifier)) {
      throw new GrpcDependencyMissingError([specifier], cause);
    }
    throw new GrpcDependencyBrokenError(
      specifier,
      cause instanceof Error
        ? `it threw while loading — ${cause.message}`
        : String(cause),
      cause,
    );
  }
  return unwrap(namespace, probe, specifier);
}

function readVersion(namespace: unknown): string | undefined {
  const v = (namespace as { version?: unknown } | undefined)?.version;
  return typeof v === "string" ? v : undefined;
}

/**
 * Probes both packages independently so a missing one can be named exactly, and
 * so "both missing" is reported once instead of as whichever lost the race.
 */
async function performLoad(): Promise<LoadedGrpc> {
  const results = await Promise.allSettled([
    importPackage(PACKAGES.grpc, "Client"),
    importPackage(PACKAGES.protoLoader, "load"),
  ]);

  const missing: string[] = [];
  for (const result of results) {
    if (
      result.status === "rejected" &&
      result.reason instanceof GrpcDependencyMissingError
    ) {
      missing.push(...result.reason.missing);
    }
  }
  if (missing.length > 0) {
    const cause = results.find((r) => r.status === "rejected");
    throw new GrpcDependencyMissingError(
      missing,
      cause?.status === "rejected" ? cause.reason : undefined,
    );
  }
  // Anything left is a broken install; rethrow the first one verbatim.
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }

  const grpc = (results[0] as PromiseFulfilledResult<unknown>).value as GrpcJs;
  const protoLoader = (results[1] as PromiseFulfilledResult<unknown>)
    .value as ProtoLoader;

  return {
    grpc,
    protoLoader,
    capabilities: {
      descriptorSetFromBuffer:
        typeof (protoLoader as { loadFileDescriptorSetFromBuffer?: unknown })
          .loadFileDescriptorSetFromBuffer === "function",
      grpcVersion: readVersion(grpc),
      protoLoaderVersion: readVersion(protoLoader),
    },
  };
}

/**
 * The in-flight promise, not the result: concurrent first callers must observe
 * one load attempt and one error object, rather than relying on the module
 * cache underneath to deduplicate for us.
 */
let inflight: Promise<LoadedGrpc> | undefined;
let resolved: LoadedGrpc | undefined;

/**
 * Loads the optional gRPC peer dependencies on first use, so HTTP-only
 * consumers never pay for them and never need them installed.
 */
export async function loadGrpc(): Promise<LoadedGrpc> {
  if (resolved) return resolved;
  if (!inflight) {
    inflight = performLoad().then(
      (loaded) => {
        resolved = loaded;
        return loaded;
      },
      (error) => {
        // Failures are not cached: an install can happen between two calls in a
        // long-lived process, and a stale rejection would outlive the fix.
        inflight = undefined;
        throw error;
      },
    );
  }
  return inflight;
}

/** Non-throwing probe, for callers deciding whether to offer gRPC at all. */
export async function isGrpcAvailable(): Promise<boolean> {
  try {
    await loadGrpc();
    return true;
  } catch {
    return false;
  }
}

/**
 * Asserts a capability, naming the version that provides it.
 *
 * Centralised here because the loader is the only place that knows what was
 * actually loaded; probing at each call site means each new call site can
 * forget to probe.
 */
export function requireCapability(
  loaded: LoadedGrpc,
  capability: keyof GrpcCapabilities,
): void {
  if (capability !== "descriptorSetFromBuffer") return;
  if (loaded.capabilities.descriptorSetFromBuffer) return;
  const found = loaded.capabilities.protoLoaderVersion
    ? ` (found ${loaded.capabilities.protoLoaderVersion})`
    : "";
  throw new GrpcDependencyBrokenError(
    PACKAGES.protoLoader,
    `server reflection requires @grpc/proto-loader >= 0.7.0${found}; ` +
      `loadFileDescriptorSetFromBuffer is missing.`,
  );
}

/** Test seam: install a stand-in, or clear the cache. Not part of the public API. */
export function __setLoadedGrpcForTests(loaded: LoadedGrpc | undefined): void {
  resolved = loaded;
  inflight = loaded ? Promise.resolve(loaded) : undefined;
}
