import { P as ProtocolAdapter, A as AdapterContext, E as ExecResult, J as Json, S as ScriptSource, a as SendOptions, b as ExecuteContext, c as ProtocolName, L as LocatedOperation, O as OperationTarget, d as SendResult } from './protocol-BBjdeNfE.js';
export { e as AssertionResult, f as AuthConfig, C as ConsoleLog, G as GraphQLOptions, M as ManualMessage, g as ManualSession, h as McpOptions, i as OpenApiDocument, R as ReplayRecord, j as RequestValues, k as RequesterOptions, l as RuntimeRunOptions, m as ScriptConfig, n as ScriptOutcome, o as ScriptReport, p as StopReason, q as StreamEvent, r as StreamParserOptions, W as WebSocketOptions, s as locateOperation } from './protocol-BBjdeNfE.js';
export { HttpAdapter, SseParser } from './protocols/http/index.js';
export { CreateWsManualSessionOptions, WebSocketAdapter, WebSocketSessionEvent, WebSocketSessionState, WsManualSession, WsSendOptions, createWsManualSession, createWsManualSession as runWebSocketSession, createWsManualSession as wsManualSession } from './protocols/ws/index.js';
export { DiscoverAndWriteResult as DiscoverAndWriteGraphQLResult, GeneratedOperation, GraphQLAdapter, GraphQLArg, GraphQLFieldInfo, GraphQLNamedType, GraphQLTypeRef, INTROSPECTION_QUERY, IntrospectedSchema, IntrospectionResult, WriteGraphQLOptions, discoverAndWriteGraphQLSchema, generateAllOperations, generateOperation, introspectSchema, resolveGraphQLConfig, writeGraphQLOperations } from './protocols/graphql/index.js';
export { D as DiscoverAndWriteMcpResult, G as GeneratedMcpCall, I as InitializeMcpSessionInit, M as MCP_PROTOCOL_VERSION, a as McpAdapter, b as McpCapability, c as McpDiscoveryResult, d as McpPrompt, e as McpResource, f as McpTool, R as ResolvedMcpConfig, W as WriteMcpOptions, g as discoverAndWriteMcpCapabilities, h as discoverMcpCapabilities, i as generateAllMcpCalls, j as generateMcpCall, k as initializeMcpSession, r as resolveMcpConfig, w as writeMcpOperations } from './index-DG2KaQHO.js';
import { G as GrpcTarget, a as GrpcEndpoint, D as DiscoveryResult } from './discovery-BB4VjHB7.js';
export { b as GrpcDiscoveredMethod, c as GrpcDiscoveredService, d as discoverGrpc, d as grpcDiscover } from './discovery-BB4VjHB7.js';

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

interface JsonRpcOutcome {
    /** The JSON-RPC response object, when the server sent one back. */
    message: any | undefined;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    contentType?: string;
    sessionId?: string;
    /** Raw text body, kept for non-JSON-RPC diagnostics. */
    rawText?: string;
    sizeBytes: number;
    firstByteMs: number;
}

type McpSessionState = "idle" | "opening" | "open" | "closing" | "closed";
interface McpSessionEvent {
    direction: "in" | "out" | "meta";
    at: number;
    event: "session" | "jsonrpc" | "notification" | "error" | "lifecycle";
    /** JSON text of `parsed`, or undefined when there was no body (202/204). */
    data?: string;
    parsed?: unknown;
}
interface McpManualSessionOptions {
    endpoint: string;
    headers?: Record<string, string>;
    clientInfo?: {
        name: string;
        version: string;
    };
    /** Client capabilities advertised at initialize. Default: {}. */
    capabilities?: Record<string, unknown>;
    /** Per-request timeout in ms. 0/undefined disables. Default 30_000. */
    timeoutMs?: number;
    /** Aborts the whole session (open, in-flight sends, close). */
    signal?: AbortSignal;
    /** Ring-buffer cap for `events`. Default 1000. 0 = unbounded. */
    maxEvents?: number;
    /** Redact secret-looking values in recorded events. Default true. */
    redactSecrets?: boolean;
    /**
     * Issue list calls one at a time. Needed only for servers that cannot
     * handle concurrent requests on one session. Default false.
     */
    serialize?: boolean;
}
interface McpRequestOptions {
    delayMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Return the raw outcome instead of throwing on JSON-RPC errors. */
    raw?: boolean;
}
interface McpListing<T> {
    items: T[];
    pages: number;
}
/** How a session-termination DELETE was answered. */
type McpTerminateOutcome = "released" | "unsupported" | "already-gone" | "failed";
interface McpManualSession {
    readonly state: McpSessionState;
    readonly sessionId: string | undefined;
    readonly protocolVersion: string | undefined;
    readonly serverInfo: {
        name: string;
        version: string;
    } | undefined;
    readonly events: readonly McpSessionEvent[];
    open(): Promise<void>;
    request<T = any>(method: string, params?: unknown, options?: McpRequestOptions): Promise<T>;
    send(message: unknown, options?: McpRequestOptions): Promise<JsonRpcOutcome>;
    notify(method: string, params?: unknown, options?: McpRequestOptions): Promise<void>;
    ping(options?: McpRequestOptions): Promise<void>;
    listTools(options?: McpRequestOptions): Promise<McpListing<any>>;
    listPrompts(options?: McpRequestOptions): Promise<McpListing<any>>;
    listResources(options?: McpRequestOptions): Promise<McpListing<any>>;
    listResourceTemplates(options?: McpRequestOptions): Promise<McpListing<any>>;
    /** Concrete resources + templates, merged. */
    listSources(options?: McpRequestOptions): Promise<McpListing<any>>;
    callTool(name: string, args?: Record<string, unknown>, options?: McpRequestOptions): Promise<any>;
    getPrompt(name: string, args?: Record<string, unknown>, options?: McpRequestOptions): Promise<any>;
    readResource(uri: string, options?: McpRequestOptions): Promise<any>;
    close(): Promise<void>;
    waitForClose(): Promise<void>;
    [Symbol.asyncDispose]?: () => Promise<void>;
}
/**
 * Long-lived, stateful MCP session over Streamable HTTP.
 *
 * Unlike `runMcp()` — which is one self-contained sample with its own
 * handshake — this keeps a single negotiated session open so a caller can
 * drive `initialize -> list -> call -> DELETE` by hand, mirroring
 * `createWsManualSession` and `createGrpcManualSession`.
 */
declare function createMcpManualSession(options: McpManualSessionOptions): McpManualSession;
/** @deprecated Use {@link createMcpManualSession}. */
declare const runMcpManualSession: typeof createMcpManualSession;

interface WriteGrpcOptions {
    pathPrefix?: string;
}
declare function writeGrpcOperations(spec: any, discovery: DiscoveryResult, endpoint: GrpcEndpoint, options?: WriteGrpcOptions): any;
declare function discoverAndWriteGrpcOperations(spec: any, endpoint: GrpcEndpoint, options?: WriteGrpcOptions): Promise<{
    spec: any;
    discovery: DiscoveryResult;
}>;
declare class GrpcProtocolAdapter implements ProtocolAdapter<any> {
    readonly name = "grpc";
    private readonly adapter;
    supports(ctx: AdapterContext): number;
    plan(ctx: AdapterContext): {
        target: GrpcTarget;
        environment: {
            name: string;
            values: {
                key: string;
                value: string;
                type: string;
                enabled: boolean;
            }[];
        };
        collection: {
            info: {
                name: string;
            };
            item: {
                name: string;
                request: {
                    method: string;
                    url: string;
                };
            }[];
        };
        streaming: boolean;
        warnings: string[];
    };
    execute(plan: any, options: SendOptions, _ctx?: ExecuteContext): Promise<ExecResult>;
}

type GrpcMethodKind = "unary" | "server_streaming" | "client_streaming" | "bidi_streaming";
type GrpcManualSessionState = "idle" | "connecting" | "open" | "closing" | "closed" | "error";
type GrpcDescriptorSourceKind = "proto" | "reflection";
interface GrpcManualSessionEvent {
    direction: "outbound" | "inbound" | "status" | "meta";
    event?: "open" | "metadata" | "data" | "status" | "error" | "end" | "close";
    payload?: unknown;
    metadata?: unknown;
    code?: number;
    details?: string;
    statusName?: string;
    error?: string;
    at: number;
}
interface GrpcManualSessionTarget {
    address: string;
    reflection?: boolean;
    protoPaths?: string[];
    service: string;
    method: string;
    metadata?: Record<string, string>;
    deadlineMs?: number;
    loaderOptions?: Record<string, unknown>;
    channelOptions?: Record<string, unknown>;
    tls?: unknown;
    reflectionTimeoutMs?: number;
    reflectionVersion?: "v1" | "v1alpha";
    reflectionHost?: string;
}
interface GrpcManualSession {
    readonly state: GrpcManualSessionState;
    readonly kind: GrpcMethodKind;
    readonly source: GrpcDescriptorSourceKind;
    readonly events: readonly GrpcManualSessionEvent[];
    readonly warnings: readonly unknown[];
    open(): Promise<void>;
    send(message: unknown): Promise<void>;
    close(): Promise<void>;
    waitForClose(): Promise<void>;
}
declare function createGrpcManualSession(target: GrpcManualSessionTarget): Promise<GrpcManualSession>;

interface DebuggerOptions {
    adapters?: ProtocolAdapter<any>[];
    extraAdapters?: ProtocolAdapter<any>[];
    writeBack?: WriteBackOptions;
    response?: ToResponseOptions;
    /**
     * Write back a schema inferred from a truncated stream.
     *
     * @default true
     */
    writeBackTruncated?: boolean;
}
interface PlanResult {
    protocol: ProtocolName | string;
    located: LocatedOperation;
    collection?: any;
    environment?: any;
    streaming?: boolean;
    warnings?: string[];
    plan: unknown;
}
interface SendManyFailure {
    target: OperationTarget;
    error: string;
}
interface SendManyResult {
    spec: any;
    results: Array<SendResult | SendManyFailure>;
}
declare function createDebugger(config?: DebuggerOptions): {
    registry: AdapterRegistry;
    toCollection: (spec: any, target: OperationTarget, overrides?: Partial<Omit<SendOptions, "spec" | "target">>) => PlanResult;
    send: (options: SendOptions) => Promise<SendResult>;
    sendMany: (spec: any, targets: Array<{
        target: OperationTarget;
    } & Partial<Omit<SendOptions, "spec" | "target">>>, shared?: Partial<Omit<SendOptions, "spec" | "target">>) => Promise<SendManyResult>;
};
type ProtoKit = ReturnType<typeof createDebugger>;

export { AdapterContext, AdapterRegistry, BUILTIN_CAPTURE_TEST, type DebuggerOptions, ExecResult, ExecuteContext, DiscoveryResult as GrpcDiscoveryResult, type GrpcManualSession, type GrpcManualSessionEvent, type GrpcManualSessionState, type GrpcManualSessionTarget, GrpcProtocolAdapter, Json, LocatedOperation, type McpListing, type McpManualSession, type McpManualSessionOptions, type McpRequestOptions, type McpSessionEvent, type McpSessionState, type McpTerminateOutcome, OperationTarget, type PlanResult, type ProtoKit, ProtoKitError, ProtocolAdapter, ProtocolName, ScriptSource, type SendManyFailure, type SendManyResult, SendOptions, SendResult, type ToResponseOptions, type WriteBackOptions, createDebugger, createGrpcManualSession, createMcpManualSession, discoverAndWriteGrpcOperations, createGrpcManualSession as grpcManualSession, inferSchema, inferSchemaFromMany, createMcpManualSession as mcpManualSession, mergeSchema, runMcpManualSession, sampleFromSchema, toResponseObject, writeBackResponse, writeGrpcOperations };
