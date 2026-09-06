import { AdapterRegistry } from "./core/registry";
import type { ProtocolAdapter } from "./core/protocol";
import { HttpAdapter } from "./protocols/http";
import { WebSocketAdapter } from "./protocols/ws";
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
} from "./core/types";
import { err, toErrorInfo } from "./core/errors";

export * from "./core/types";
export { ProtoKitError } from "./core/errors";
export { AdapterRegistry } from "./core/registry";
export type { ProtocolAdapter, AdapterContext } from "./core/protocol";
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

export interface DebuggerOptions {
  /** Replaces the default adapter set when provided. */
  adapters?: ProtocolAdapter<any>[];
  /** Adapters appended to the default set. */
  extraAdapters?: ProtocolAdapter<any>[];
  writeBack?: WriteBackOptions;
  response?: ToResponseOptions;
}

export interface PlanResult {
  protocol: string;
  located: LocatedOperation;
  collection?: any;
  environment?: any;
  streaming?: boolean;
  plan: unknown;
}

export function createDebugger(config: DebuggerOptions = {}) {
  const registry = new AdapterRegistry();
  const base = config.adapters ?? [new HttpAdapter(), new WebSocketAdapter()];
  for (const adapter of [...base, ...(config.extraAdapters ?? [])])
    registry.register(adapter);

  const prepare = (options: SendOptions) => {
    if (!options || typeof options !== "object")
      throw err("BAD_OPTIONS", "send() requires an options object");
    const located = locateOperation(options.spec, options.target);
    const ctx = { spec: options.spec, options, located };
    const adapter = registry.resolve(ctx);
    const plan = adapter.plan(ctx);
    return { located, adapter, plan };
  };

  return {
    registry,

    /** Inspect the generated artifacts without performing any network I/O. */
    toCollection(
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
        plan,
      };
    },

    /** Execute the operation and fold the observed response back into the spec. */
    async send(options: SendOptions): Promise<SendResult> {
      const { located, adapter, plan } = prepare(options);

      let result: ExecResult;
      try {
        result = await adapter.execute(plan, options);
      } catch (e) {
        throw err(
          "EXECUTION_FAILED",
          `Adapter "${adapter.name}" failed: ${toErrorInfo(e).message}`,
          e,
        );
      }

      const fragment = toResponseObject(result, config.response);
      const anyPlan = plan as any;

      let patchedSpec: any;
      let writeBackSkippedReason: string | undefined;

      if (options.writeBack === false) {
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
      } else {
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
      };
    },

    /**
     * Run several operations in order, threading the patched spec through
     * so that repeated observations accumulate into one schema.
     */
    async sendMany(
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
        try {
          const result = await this.send({
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
    },
  };
}

export type ProtoKit = ReturnType<typeof createDebugger>;
