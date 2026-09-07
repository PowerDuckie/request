
import type { ProtocolAdapter, AdapterContext, ExecuteContext } from "../../core/protocol";
import type { ExecResult, SendOptions, StreamEvent } from "../../core/types";
import { grpcCall } from "./call.js";
import { discover } from "./discovery.js";
import type { DiscoveryResult } from "./discovery.js";
import type { GrpcEndpoint, GrpcTarget, GrpcSendOptions } from "./types.js";
import { GrpcAdapter } from "./adapter.js";
import { err } from "../../core/errors";
import { runWebSocketSession } from "../ws/session.js";
import { runMcpManualSession } from "../mcp/session.js";

export interface GrpcOperationExtension {
  address: string;
  service: string;
  method: string;
  reflection?: boolean;
  protoPaths?: string[];
  includeDirs?: string[];
  ignoreDirs?: string[];
}

export interface WriteGrpcOptions {
  pathPrefix?: string;
}

export function writeGrpcOperations(
  spec: any,
  discovery: DiscoveryResult,
  endpoint: GrpcEndpoint,
  options: WriteGrpcOptions = {},
): any {
  const next = structuredClone(spec ?? {});
  next.openapi ??= "3.2.0";
  next.paths ??= {};
  const prefix = (options.pathPrefix ?? "/grpc").replace(/\/+$/, "");
  for (const svc of discovery.services) {
    for (const m of svc.methods) {
      const path = `${prefix}/${svc.name.replace(/\./g, "/")}/${m.name}`;
      next.paths[path] ??= {};
      next.paths[path].post = {
        operationId: `grpc_${svc.name.replace(/\./g, "_")}_${m.name}`.replace(/[^A-Za-z0-9_]/g, "_"),
        summary: `${svc.name}/${m.name}`,
        tags: ["grpc"],
        "x-protocol": "grpc",
        "x-grpc": {
          address: endpoint.address,
          service: svc.name,
          method: m.name,
          reflection: (endpoint as any).reflection === true ? true : undefined,
          protoPaths: (endpoint as any).protoPaths,
          includeDirs: (endpoint as any).includeDirs,
          ignoreDirs: (endpoint as any).ignoreDirs,
        },
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  messages: { type: "array", items: { type: "object" } },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "gRPC result envelope" },
          default: { description: "gRPC error" },
        },
      };
    }
  }
  return next;
}

export async function discoverAndWriteGrpcOperations(
  spec: any,
  endpoint: GrpcEndpoint,
  options: WriteGrpcOptions = {},
): Promise<{ spec: any; discovery: DiscoveryResult }> {
  const result = await discover(endpoint);
  return { spec: writeGrpcOperations(spec, result, endpoint, options), discovery: result };
}

function resolveGrpcTarget(located: any, options: SendOptions): GrpcTarget {
  const ext = (located.operation?.["x-grpc"] ?? {}) as GrpcOperationExtension;
  const grpc = (options as any).grpc ?? {};
  const base: any = { ...ext, ...grpc };
  if (!base.address || !base.service || !base.method) {
    throw err("BAD_GRPC_TARGET", "x-grpc or options.grpc must define address, service and method");
  }
  if (base.reflection !== true && (!Array.isArray(base.protoPaths) || base.protoPaths.length === 0)) {
    throw err("BAD_GRPC_TARGET", "gRPC target needs reflection:true or non-empty protoPaths");
  }
  return base as GrpcTarget;
}

function grpcToExecResult(result: any): ExecResult {
  const status = result.status?.code === 0 ? 200 : 500;
  const events: StreamEvent[] = result.events.map((e: any) => ({
    id: String(e.seq),
    event: e.direction,
    data: JSON.stringify(e.direction === "status" ? e.status : e.direction === "meta" ? e.metadata : e.payload),
    parsed: (e.direction === "status" ? e.status : e.direction === "meta" ? e.metadata : e.payload),
    receivedAt: e.at,
    direction: e.direction === "outbound" ? "out" : "in",
  }));
  return {
    protocol: "grpc",
    request: {
      method: "GRPC",
      url: `grpc://${result.target.address}/${result.target.service}/${result.target.method}`,
      headers: result.target.metadata ?? {},
      body: result.kind === "unary" || result.kind === "server_streaming" ? result.events.filter((e:any)=>e.direction==="outbound").map((e:any)=>e.payload)[0] : result.events.filter((e:any)=>e.direction==="outbound").map((e:any)=>e.payload),
    },
    response: {
      status,
      statusText: result.status?.codeName ?? "UNKNOWN",
      headers: result.initialMetadata ?? {},
      body: {
        kind: result.kind,
        messages: result.messages,
        status: result.status,
        trailers: result.trailers,
        events: result.events,
        truncated: result.truncated,
        truncatedReason: result.truncatedReason,
        warnings: result.warnings,
      },
      contentType: "application/json",
      events,
      timings: {
        startedAt: Date.now() - result.durationMs,
        endedAt: Date.now(),
        durationMs: result.durationMs,
      },
      sizeBytes: JSON.stringify(result.messages ?? []).length,
      ...(result.truncated ? { truncated: true, stopReason: "maxEvents" as any } : {}),
    },
    ...(result.error ? { error: { message: result.error, code: result.status?.codeName } } : {}),
  };
}

export class GrpcProtocolAdapter implements ProtocolAdapter<any> {
  readonly name = "grpc";
  private readonly adapter = new GrpcAdapter();

  supports(ctx: AdapterContext): number {
    const op = ctx.located.operation ?? {};
    if (op["x-protocol"] === "grpc") return 20;
    if (op["x-grpc"]) return 18;
    if ((ctx.options as any).grpc?.address) return 15;
    return 0;
  }
  plan(ctx: AdapterContext) {
    const target = resolveGrpcTarget(ctx.located, ctx.options);
    return {
      target,
      environment: {
        name: `${ctx.spec?.info?.title ?? "API"} gRPC Environment`,
        values: [{ key: "grpcAddress", value: target.address, type: "default", enabled: true }],
      },
      collection: {
        info: { name: `${target.service}/${target.method}` },
        item: [{ name: `${target.service}/${target.method}`, request: { method: "GRPC", url: `grpc://${target.address}/${target.service}/${target.method}` } }],
      },
      streaming: true,
      warnings: [`linked into OpenAPI as operationId grpc_${target.service.replace(/\./g, "_")}_${target.method}`],
    };
  }
  async execute(plan: any, options: SendOptions, _ctx?: ExecuteContext): Promise<ExecResult> {
    const sendOpts: GrpcSendOptions = options.values?.body as any ?? (options as any).grpc?.sendOptions ?? {};
    const result = await grpcCall(plan.target, sendOpts);
    return grpcToExecResult(result);
  }
}

export function wsManualSession(config: any) {
  return runWebSocketSession(config);
}

export function mcpManualSession(config: any) {
  return runMcpManualSession(config);
}

export async function grpcManualSession(target: GrpcTarget, options: GrpcSendOptions = {}) {
  const stream = await import("./session.js");
  return stream.createGrpcManualSession(target, options);
}
