import { AdapterRegistry } from "./core/registry";
import type { ProtocolAdapter, ExecuteContext } from "./core/protocol";
import { HttpAdapter } from "./protocols/http";
import { WebSocketAdapter } from "./protocols/ws";
import { GraphQLAdapter } from "./protocols/graphql";
import { McpAdapter } from "./protocols/mcp";
import { GrpcProtocolAdapter } from "./protocols/grpc/openapi";
import { locateOperation, type LocatedOperation } from "./openapi/locate";
import {
  toResponseObject,
  writeBackResponse,
  type WriteBackOptions,
  type ToResponseOptions,
} from "./openapi/writeback";
import type {
  SendOptions,
  SendResult,
  OperationTarget,
  ExecResult,
  ProtocolName,
} from "./core/types";
import { err, toErrorInfo, ProtoKitError } from "./core/errors";

export * from "./core/types";
export { ProtoKitError } from "./core/errors";
export { AdapterRegistry } from "./core/registry";
export type {
  ProtocolAdapter,
  AdapterContext,
  ExecuteContext,
} from "./core/protocol";
export { locateOperation } from "./openapi/locate";
export type { LocatedOperation } from "./openapi/locate";
export { inferSchema, inferSchemaFromMany } from "./openapi/infer";
export { mergeSchema } from "./openapi/merge";
export { sampleFromSchema } from "./openapi/sample";
export { toResponseObject, writeBackResponse } from "./openapi/writeback";
export type { WriteBackOptions, ToResponseOptions } from "./openapi/writeback";
export { HttpAdapter } from "./protocols/http";
export { WebSocketAdapter } from "./protocols/ws";
export { BUILTIN_CAPTURE_TEST } from "./protocols/http/scripts";
export { SseParser } from "./protocols/http/sse-parser";

export { GraphQLAdapter } from "./protocols/graphql";
export { resolveGraphQLConfig } from "./protocols/graphql/config";
export {
  introspectSchema,
  INTROSPECTION_QUERY,
} from "./protocols/graphql/introspection";
export type {
  IntrospectedSchema,
  IntrospectionResult,
  GraphQLNamedType,
  GraphQLFieldInfo,
  GraphQLArg,
  GraphQLTypeRef,
} from "./protocols/graphql/introspection";
export {
  generateOperation,
  generateAllOperations,
} from "./protocols/graphql/generate";
export type { GeneratedOperation } from "./protocols/graphql/generate";
export {
  writeGraphQLOperations,
  discoverAndWriteGraphQLSchema,
} from "./protocols/graphql/writeback";
export type {
  WriteGraphQLOptions,
  DiscoverAndWriteResult as DiscoverAndWriteGraphQLResult,
} from "./protocols/graphql/writeback";

export { McpAdapter } from "./protocols/mcp";
export { GrpcProtocolAdapter, writeGrpcOperations, discoverAndWriteGrpcOperations, grpcManualSession, mcpManualSession, wsManualSession } from "./protocols/grpc/openapi";
export { resolveMcpConfig } from "./protocols/mcp/config";
export {
  initializeSession as initializeMcpSession,
  discoverMcpCapabilities,
  MCP_PROTOCOL_VERSION,
} from "./protocols/mcp/discovery";
export type {
  McpCapability,
  McpTool,
  McpResource,
  McpPrompt,
  McpDiscoveryResult,
} from "./protocols/mcp/discovery";
export {
  generateMcpCall,
  generateAllMcpCalls,
} from "./protocols/mcp/generate";
export type { GeneratedMcpCall } from "./protocols/mcp/generate";
export {
  writeMcpOperations,
  discoverAndWriteMcpCapabilities,
} from "./protocols/mcp/writeback";
export type {
  WriteMcpOptions,
  DiscoverAndWriteMcpResult,
} from "./protocols/mcp/writeback";

export interface DebuggerOptions {
  /** Replaces the default adapter set when provided. */
  adapters?: ProtocolAdapter<any>[];
  /** Adapters appended to the default set. */
  extraAdapters?: ProtocolAdapter<any>[];
  writeBack?: WriteBackOptions;
  response?: ToResponseOptions;
  /**
   * Write back a schema inferred from a truncated stream.
   *
   * @default true
   *
   * A sampled stream stops at `maxEvents` or `maxStreamMs`, so its schema
   * reflects only the events observed. That is usually what the caller wants,
   * but it can under-report optional fields that appear later in the stream.
   * Either way `writeBackWarnings` explains what happened.
   */
  writeBackTruncated?: boolean;
}

export interface PlanResult {
  protocol: ProtocolName | string;
  located: LocatedOperation;
  collection?: any;
  environment?: any;
  streaming?: boolean;
  /** Non-fatal issues raised while generating the artifacts. */
  warnings?: string[];
  plan: unknown;
}

export function createDebugger(config: DebuggerOptions = {}) {
  const registry = new AdapterRegistry();
  const base = config.adapters ?? [
    new HttpAdapter(),
    new WebSocketAdapter(),
    new GraphQLAdapter(),
    new McpAdapter(),
    new GrpcProtocolAdapter(),
  ];
  for (const adapter of [...base, ...(config.extraAdapters ?? [])])
    registry.register(adapter);

  const prepare = (options: SendOptions) => {
    if (!options || typeof options !== "object")
      throw err("BAD_OPTIONS", "send() requires an options object");
    if (!options.spec || typeof options.spec !== "object")
      throw err("BAD_OPTIONS", "send() requires options.spec");

    const located = locateOperation(options.spec, options.target);
    const ctx = { spec: options.spec, options, located };
    const adapter = registry.resolve(ctx);

    // plan() validates caller-supplied configuration, so its errors are already
    // specific (BAD_WS_URL, BAD_WS_OPTIONS, ...) and must not be re-wrapped.
    const plan = adapter.plan(ctx);
    return { located, adapter, plan };
  };

  /**
   * Execute through the adapter, preserving the original error code.
   *
   * Wrapping everything as EXECUTION_FAILED would hide whether the collection
   * was malformed, the runtime failed to start, or the network broke.
   */
  const execute = async (
    adapter: ProtocolAdapter<any>,
    plan: unknown,
    options: SendOptions,
  ): Promise<ExecResult> => {
    const ctx: ExecuteContext | undefined = options.signal
      ? { signal: options.signal }
      : undefined;
    try {
      return await adapter.execute(plan, options, ctx);
    } catch (e) {
      if (ProtoKitError.isProtoKitError(e)) throw e;
      throw err(
        "EXECUTION_FAILED",
        `Adapter "${adapter.name}" failed: ${toErrorInfo(e).message}`,
        e,
      );
    }
  };

  /** Inspect the generated artifacts without performing any network I/O. */
  function toCollection(
    spec: any,
    target: OperationTarget,
    overrides: Partial<Omit<SendOptions, "spec" | "target">> = {},
  ): PlanResult {
    const options = { ...overrides, spec, target } as SendOptions;
    const { located, adapter, plan } = prepare(options);
    const anyPlan = plan as any;
    return {
      protocol: adapter.name,
      located,
      collection: anyPlan?.collection,
      environment: anyPlan?.environment,
      streaming: anyPlan?.streaming,
      warnings: Array.isArray(anyPlan?.warnings) ? anyPlan.warnings : undefined,
      plan,
    };
  }

  /** Execute the operation and fold the observed response back into the spec. */
  async function send(options: SendOptions): Promise<SendResult> {
    const { located, adapter, plan } = prepare(options);
    const result = await execute(adapter, plan, options);
    const anyPlan = plan as any;

    const warnings: string[] = Array.isArray(anyPlan?.warnings)
      ? [...anyPlan.warnings]
      : [];

    // A failure here must not discard an otherwise usable result.
    let fragment: { response: any; statusCode: string };
    let fragmentError: string | undefined;
    try {
      fragment = toResponseObject(result, config.response);
    } catch (e) {
      fragmentError = `response fragment error: ${toErrorInfo(e).message}`;
      fragment = {
        response: { description: "Fragment generation failed" },
        statusCode: String(result.response.status || "default"),
      };
      warnings.push(fragmentError);
    }

    let patchedSpec: any;
    let writeBackSkippedReason: string | undefined;

    if (fragmentError) {
      writeBackSkippedReason = fragmentError;
    } else if (options.writeBack === false) {
      writeBackSkippedReason = "disabled by options.writeBack";
    } else if (result.response.status <= 0) {
      writeBackSkippedReason = "no response was received";
    } else if (result.scripts?.skipped) {
      writeBackSkippedReason = "request was skipped by a script";
    } else if (
      config.writeBack?.requirePassingTests !== false &&
      result.scripts?.passed === false
    ) {
      writeBackSkippedReason = "one or more assertions failed";
    } else if (
      result.response.truncated &&
      config.writeBackTruncated === false
    ) {
      writeBackSkippedReason = `stream was truncated (${
        result.response.stopReason ?? "unknown limit"
      })`;
    } else {
      if (result.response.truncated) {
        warnings.push(
          `Schema inferred from a truncated stream (${
            result.response.stopReason ?? "unknown limit"
          }); fields appearing later were not observed.`,
        );
      }
      if (result.response.droppedEvents) {
        warnings.push(
          `${result.response.droppedEvents} event(s) exceeded the size caps and were not fully retained.`,
        );
      }
      try {
        patchedSpec = writeBackResponse(
          options.spec,
          located.path,
          located.method,
          fragment,
          config.writeBack,
        );
      } catch (e) {
        writeBackSkippedReason = `write-back error: ${toErrorInfo(e).message}`;
      }
    }

    return {
      ...result,
      collection: anyPlan?.collection,
      environment: anyPlan?.environment,
      responseFragment: fragment.response,
      responseStatusCode: fragment.statusCode,
      patchedSpec,
      writeBackSkippedReason,
      ...(warnings.length ? { writeBackWarnings: warnings } : {}),
    };
  }

  /**
   * Run several operations in order, threading the patched spec through
   * so that repeated observations accumulate into one schema.
   *
   * `shared` is merged shallowly: a per-entry `variables` or `runner` replaces
   * the shared one rather than being deep-merged, because `runner` is passed
   * verbatim to postman-runtime and a partial merge there is hard to reason about.
   */
  async function sendMany(
    spec: any,
    targets: Array<
      { target: OperationTarget } & Partial<
        Omit<SendOptions, "spec" | "target">
      >
    >,
    shared: Partial<Omit<SendOptions, "spec" | "target">> = {},
  ): Promise<{
    spec: any;
    results: Array<SendResult | { target: OperationTarget; error: string }>;
  }> {
    let working = spec;
    const results: Array<
      SendResult | { target: OperationTarget; error: string }
    > = [];

    for (const entry of targets) {
      // Stop early rather than firing the remaining requests after a cancel.
      const signal = entry.signal ?? shared.signal;
      if (signal?.aborted) {
        results.push({ target: entry.target, error: "aborted" });
        continue;
      }
      try {
        // Referenced directly so a destructured `sendMany` still works.
        const result = await send({
          ...shared,
          ...entry,
          spec: working,
        } as SendOptions);
        if (result.patchedSpec) working = result.patchedSpec;
        results.push(result);
      } catch (e) {
        results.push({ target: entry.target, error: toErrorInfo(e).message });
      }
    }
    return { spec: working, results };
  }

  return { registry, toCollection, send, sendMany };
}

export type ProtoKit = ReturnType<typeof createDebugger>;
