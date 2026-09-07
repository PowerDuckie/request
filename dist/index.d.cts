import { P as ProtocolAdapter, A as AdapterContext, E as ExecResult, J as Json, S as ScriptSource, a as ProtocolName, L as LocatedOperation, O as OperationTarget, b as SendOptions, c as SendResult } from './protocol-xeNbDlvO.cjs';
export { d as AssertionResult, e as AuthConfig, C as ConsoleLog, f as ExecuteContext, g as OpenApiDocument, R as ReplayRecord, h as RequestValues, i as RequesterOptions, j as RuntimeRunOptions, k as ScriptConfig, l as ScriptOutcome, m as ScriptReport, n as StopReason, o as StreamEvent, p as StreamParserOptions, W as WebSocketOptions, q as locateOperation } from './protocol-xeNbDlvO.cjs';
export { HttpAdapter, SseParser } from './protocols/http/index.cjs';
export { WebSocketAdapter } from './protocols/ws/index.cjs';

declare class AdapterRegistry {
    private readonly entries;
    private nextSeq;
    register(adapter: ProtocolAdapter<any>): this;
    unregister(name: string): boolean;
    get(name: string): ProtocolAdapter<any> | undefined;
    list(): string[];
    /** Ranked candidates, best first. Useful for diagnostics. */
    rank(ctx: AdapterContext): Array<{
        name: string;
        score: number;
    }>;
    resolve(ctx: AdapterContext): ProtocolAdapter<any>;
    /** Coerce a score into a usable finite number; any fault means "unsupported". */
    private scoreOf;
}

interface ToResponseOptions {
    /** Cap on the size of captured example payloads, in characters. */
    maxExampleChars?: number;
    /** Include a captured example under `content[mediaType].examples`. Defaults to true. */
    includeExamples?: boolean;
    /** Cap on characters retained per non-JSON stream event. Defaults to 200. */
    maxEventPreviewChars?: number;
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
    /** Only write back these status codes. Empty means all. */
    allowedStatusCodes?: string[];
    /** Refuse to touch responses whose schema is a $ref to a shared component. Defaults to true. */
    protectComponentRefs?: boolean;
    /** Overwrite an existing captured example. Defaults to true. */
    overwriteExamples?: boolean;
    requirePassingTests?: boolean;
}
/**
 * Merge a response fragment into a copy of the spec.
 * The input document is never mutated.
 *
 * Note: gating on test results is the caller's responsibility; this function
 * writes whatever fragment it is handed.
 */
declare function writeBackResponse(spec: any, path: string, method: string, fragment: {
    statusCode: string;
    response: any;
}, options?: WriteBackOptions): any;

/**
 * Unified error type for the whole toolkit.
 * `code` is a stable machine-readable identifier; `message` is human-facing.
 */
/**
 * Brand used to identify our errors across module realms. Relying on
 * `instanceof` alone is unsafe: a consumer may end up loading both the ESM and
 * the CJS build, which creates two distinct classes.
 */
declare const PROTOKIT_ERROR_BRAND: unique symbol;
declare class ProtoKitError extends Error {
    readonly code: string;
    readonly details?: unknown;
    /** Brand marker; see PROTOKIT_ERROR_BRAND. */
    readonly [PROTOKIT_ERROR_BRAND]: true;
    constructor(message: string, code: string, details?: unknown, options?: {
        cause?: unknown;
    });
    /**
     * Realm-safe replacement for `instanceof ProtoKitError`.
     * Use this everywhere instead of a bare instanceof check.
     */
    static isProtoKitError(value: unknown): value is ProtoKitError;
    /** Plain, serializable projection. Safe to log or send over a wire. */
    toJSON(): {
        name: string;
        code: string;
        message: string;
        details?: unknown;
    };
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
    /** Maximum properties inspected per object. Defaults to 250. */
    maxProperties?: number;
}
/**
 * Derive a JSON Schema from an observed runtime value.
 *
 * `null` yields `{ type: "null" }` because it is a real observation, while
 * `undefined` yields `{}` since the absence of a value proves nothing.
 */
declare function inferSchema(value: Json | undefined, options?: InferOptions, depth?: number): any;
/** Fold a list of observed values into a single unified schema. */
declare function inferSchemaFromMany(values: Array<Json | undefined>, options?: InferOptions): any;

/**
 * Least-upper-bound merge for two JSON Schemas.
 *
 * The guiding rule is that merging must never lose information a user wrote by
 * hand. Keywords this module does not explicitly understand are carried over
 * verbatim instead of being dropped, because `mergeSchema` is also used to fold
 * a live observation into an author-maintained document.
 */
/**
 * Merge two JSON Schemas into their least upper bound.
 *
 * Types become a union, object properties are unioned, `required` shrinks to the
 * intersection so optional fields stay optional, and numeric or length bounds
 * widen to cover both inputs. Unknown keywords and `x-` extensions survive.
 */
declare function mergeSchema(a: any, b: any, depth?: number): any;

/**
 * Produce a representative value for a JSON Schema so that required
 * parameters and request bodies are never left empty.
 *
 * Sampling is deterministic: the same schema always yields the same value, which
 * keeps generated requests reproducible across runs. Values respect declared
 * bounds (minimum, maxLength, minItems, ...) so a sample never violates the
 * schema it came from.
 */
interface SampleOptions {
    /** Maximum recursion depth. Defaults to 12. */
    maxDepth?: number;
    /** Include readOnly properties. Defaults to false. */
    includeReadOnly?: boolean;
    /** Include writeOnly properties. Defaults to true. */
    includeWriteOnly?: boolean;
}
declare function sampleFromSchema(schema: any, depth?: number, options?: SampleOptions): any;

/**
 * Optional helper script that exposes the last response to subsequent requests.
 * The captured body is truncated, since an environment value is serialized in
 * full on every scope snapshot.
 */
declare const BUILTIN_CAPTURE_TEST: ScriptSource;

interface DebuggerOptions {
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
interface PlanResult {
    protocol: ProtocolName | string;
    located: LocatedOperation;
    collection?: any;
    environment?: any;
    streaming?: boolean;
    /** Non-fatal issues raised while generating the artifacts. */
    warnings?: string[];
    plan: unknown;
}
declare function createDebugger(config?: DebuggerOptions): {
    registry: AdapterRegistry;
    toCollection: (spec: any, target: OperationTarget, overrides?: Partial<Omit<SendOptions, "spec" | "target">>) => PlanResult;
    send: (options: SendOptions) => Promise<SendResult>;
    sendMany: (spec: any, targets: Array<{
        target: OperationTarget;
    } & Partial<Omit<SendOptions, "spec" | "target">>>, shared?: Partial<Omit<SendOptions, "spec" | "target">>) => Promise<{
        spec: any;
        results: Array<SendResult | {
            target: OperationTarget;
            error: string;
        }>;
    }>;
};
type ProtoKit = ReturnType<typeof createDebugger>;

export { AdapterContext, AdapterRegistry, BUILTIN_CAPTURE_TEST, type DebuggerOptions, ExecResult, Json, LocatedOperation, OperationTarget, type PlanResult, type ProtoKit, ProtoKitError, ProtocolAdapter, ProtocolName, ScriptSource, SendOptions, SendResult, type ToResponseOptions, type WriteBackOptions, createDebugger, inferSchema, inferSchemaFromMany, mergeSchema, sampleFromSchema, toResponseObject, writeBackResponse };
