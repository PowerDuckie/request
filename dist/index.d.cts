import { P as ProtocolAdapter, A as AdapterContext, E as ExecResult, J as Json, S as ScriptSource, L as LocatedOperation, O as OperationTarget, a as SendOptions, b as SendResult } from './protocol-58EyJAsY.cjs';
export { c as AssertionResult, d as AuthConfig, C as ConsoleLog, e as ProtocolName, R as ReplayRecord, f as RequestValues, g as RequesterOptions, h as RuntimeRunOptions, i as ScriptConfig, j as ScriptOutcome, k as ScriptReport, l as StreamEvent, W as WebSocketOptions, m as locateOperation } from './protocol-58EyJAsY.cjs';
export { HttpAdapter } from './protocols/http/index.cjs';
export { WebSocketAdapter } from './protocols/ws/index.cjs';

declare class AdapterRegistry {
    private readonly adapters;
    register(adapter: ProtocolAdapter<any>): this;
    list(): string[];
    resolve(ctx: AdapterContext): ProtocolAdapter<any>;
}

interface ToResponseOptions {
    /** Cap on the size of captured example payloads, in characters. */
    maxExampleChars?: number;
    /** Include a captured example under `content[mediaType].examples`. Defaults to true. */
    includeExamples?: boolean;
}
/** Convert a single execution result into an OpenAPI 3.2 Response Object. */
declare function toResponseObject(result: ExecResult, options?: ToResponseOptions): {
    statusCode: string;
    response: any;
};
interface WriteBackOptions {
    /** 'merge' unions the new observation into the existing schema. Defaults to 'merge'. */
    strategy?: "merge" | "replace";
    /** Preserve a hand-written description instead of the HTTP reason phrase. Defaults to true. */
    keepExistingDescription?: boolean;
    /** Skip write-back when any assertion failed. Defaults to true. */
    requirePassingTests?: boolean;
    /** Only write back these status codes. Empty means all. */
    allowedStatusCodes?: string[];
    /** Refuse to touch responses whose schema is a $ref to a shared component. Defaults to true. */
    protectComponentRefs?: boolean;
}
/**
 * Merge a response fragment into a copy of the spec.
 * The input document is never mutated.
 */
declare function writeBackResponse(spec: any, path: string, method: string, fragment: {
    statusCode: string;
    response: any;
}, options?: WriteBackOptions): any;

/**
 * Unified error type for the whole toolkit.
 * `code` is a stable machine-readable identifier; `message` is human-facing.
 */
declare class ProtoKitError extends Error {
    readonly code: string;
    readonly details?: unknown;
    constructor(message: string, code: string, details?: unknown);
}

interface InferOptions {
    /** Maximum nesting depth to inspect. Defaults to 12. */
    maxDepth?: number;
    /** Number of array elements sampled when unifying item schemas. Defaults to 20. */
    sampleArrayItems?: number;
    /** Maximum characters retained in string examples. Defaults to 120. */
    maxExampleLength?: number;
    /** Emit example values alongside the inferred schema. Defaults to true. */
    includeExamples?: boolean;
}
/** Derive a JSON Schema from an observed runtime value. */
declare function inferSchema(value: Json, options?: InferOptions, depth?: number): any;
/** Fold a list of observed values into a single unified schema. */
declare function inferSchemaFromMany(values: Json[], options?: InferOptions): any;

/**
 * Merge two JSON Schemas into their least upper bound.
 * Types become a union, object properties are unioned, and `required`
 * shrinks to the intersection so optional fields stay optional.
 */
declare function mergeSchema(a: any, b: any, depth?: number): any;

/**
 * Produce a representative value for a JSON Schema so that required
 * parameters and request bodies are never left empty.
 */
declare function sampleFromSchema(schema: any, depth?: number): any;

/** Optional helper script that exposes the last response to subsequent requests. */
declare const BUILTIN_CAPTURE_TEST: ScriptSource;

interface DebuggerOptions {
    /** Replaces the default adapter set when provided. */
    adapters?: ProtocolAdapter<any>[];
    /** Adapters appended to the default set. */
    extraAdapters?: ProtocolAdapter<any>[];
    writeBack?: WriteBackOptions;
    response?: ToResponseOptions;
}
interface PlanResult {
    protocol: string;
    located: LocatedOperation;
    collection?: any;
    environment?: any;
    streaming?: boolean;
    plan: unknown;
}
declare function createDebugger(config?: DebuggerOptions): {
    registry: AdapterRegistry;
    /** Inspect the generated artifacts without performing any network I/O. */
    toCollection(spec: any, target: OperationTarget, overrides?: Partial<Omit<SendOptions, "spec" | "target">>): PlanResult;
    /** Execute the operation and fold the observed response back into the spec. */
    send(options: SendOptions): Promise<SendResult>;
    /**
     * Run several operations in order, threading the patched spec through
     * so that repeated observations accumulate into one schema.
     */
    sendMany(spec: any, targets: Array<{
        target: OperationTarget;
    } & Partial<Omit<SendOptions, "spec" | "target">>>, shared?: Partial<Omit<SendOptions, "spec" | "target">>): Promise<{
        spec: any;
        results: Array<SendResult | {
            target: OperationTarget;
            error: string;
        }>;
    }>;
};
type ProtoKit = ReturnType<typeof createDebugger>;

export { AdapterContext, AdapterRegistry, BUILTIN_CAPTURE_TEST, type DebuggerOptions, ExecResult, Json, LocatedOperation, OperationTarget, type PlanResult, type ProtoKit, ProtoKitError, ProtocolAdapter, ScriptSource, SendOptions, SendResult, type ToResponseOptions, type WriteBackOptions, createDebugger, inferSchema, inferSchemaFromMany, mergeSchema, sampleFromSchema, toResponseObject, writeBackResponse };
