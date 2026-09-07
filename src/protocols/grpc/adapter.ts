import { grpcCall } from "./call.js";
import { resolveMethod } from "./descriptor.js";
import { discover, describeMethod } from "./discovery.js";
import type { GrpcEndpoint, GrpcSendOptions, GrpcTarget } from "./types.js";

export interface GrpcPlan {
  collection: unknown;
  environment: unknown;
  warnings: string[];
  streaming: boolean;
}

export class GrpcAdapter {
  readonly protocol = "grpc" as const;

  supports(target: unknown): boolean {
    const t = target as Partial<GrpcTarget> | null;
    return (
      !!t &&
      typeof t.address === "string" &&
      typeof t.service === "string" &&
      typeof t.method === "string"
    );
  }

  async plan(target: unknown): Promise<GrpcPlan> {
    const t = target as GrpcTarget;
    const method = await resolveMethod(t);

    const warnings = [
      ...method.notes,
      "gRPC requests are exported as a non-standard Postman collection item; " +
        "anything beyond address, method and message is lossy.",
      "gRPC results cannot be written back into an OpenAPI document; " +
        "writeBack is ignored for protocol=grpc.",
    ];

    return {
      streaming: method.requestStream || method.responseStream,
      warnings,
      environment: { baseUrl: t.address },
      collection: {
        info: {
          name: `${t.service}/${t.method}`,
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            name: `${t.service}/${t.method}`,
            request: {
              method: "GRPC",
              url: { raw: `grpc://${t.address}${method.path}` },
              description: `kind=${method.kind} source=${method.source}`,
              header: Object.entries(t.metadata ?? {}).map(([key, value]) => ({
                key,
                value: Array.isArray(value) ? value.join(", ") : value,
              })),
            },
            protocolProfileBehavior: {
              grpc: {
                service: t.service,
                methodName: t.method,
                methodType: method.kind,
                url: t.address,
                tls: t.tls !== undefined && t.tls !== false,
              },
            },
          },
        ],
      },
    };
  }

  async run(target: unknown, options: unknown) {
    return grpcCall(target as GrpcTarget, (options ?? {}) as GrpcSendOptions);
  }

  /** Not part of ProtocolAdapter; exposed for discovery UIs. */
  async discover(endpoint: GrpcEndpoint) {
    return discover(endpoint);
  }

  async describeMethod(
    endpoint: GrpcEndpoint,
    service: string,
    method: string,
  ) {
    return describeMethod(endpoint, service, method, { includeResponse: true });
  }
}
