import { P as ProtocolAdapter, A as AdapterContext, E as ExecResult, J as Json, S as ScriptSource, L as LocatedOperation, a as SendOptions, b as ExecuteContext, c as ProtocolName, O as OperationTarget, d as SendResult } from './protocol-BJQL8oGn.js';
export { e as AssertionResult, f as AuthConfig, C as ConsoleLog, G as GraphQLOptions, M as McpOptions, g as OpenApiDocument, R as ReplayRecord, h as RequestValues, i as RequesterOptions, j as RuntimeRunOptions, k as ScriptConfig, l as ScriptOutcome, m as ScriptReport, n as StopReason, o as StreamEvent, p as StreamParserOptions, W as WebSocketOptions, q as locateOperation } from './protocol-BJQL8oGn.js';
export { HttpAdapter, SseParser } from './protocols/http/index.js';
export { WebSocketAdapter } from './protocols/ws/index.js';

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

interface ResolvedGraphQLConfig {
    endpoint: string;
    query: string;
    operationName?: string;
    variables: Record<string, unknown>;
    headers: Record<string, string>;
    useGet: boolean;
}
/**
 * Resolve the effective GraphQL call.
 *
 * Precedence for each field: `options.graphql.*` (explicit per-call override)
 * > `operation['x-graphql'].*` (the document's declared operation, normally
 * produced by {@link writeGraphQLOperations}) > a bare `POST {server}/graphql`
 * fallback with no query, which is rejected below.
 */
declare function resolveGraphQLConfig(located: LocatedOperation, spec: any, options: SendOptions): ResolvedGraphQLConfig;

/** Standard GraphQL introspection query (spec-October2021), trimmed of directive locations we don't use. */
declare const INTROSPECTION_QUERY: string;
interface GraphQLTypeRef {
    kind: string;
    name?: string | null;
    ofType?: GraphQLTypeRef | null;
}
interface GraphQLArg {
    name: string;
    description?: string | null;
    type: GraphQLTypeRef;
    defaultValue?: string | null;
}
interface GraphQLFieldInfo {
    name: string;
    description?: string | null;
    args: GraphQLArg[];
    type: GraphQLTypeRef;
    isDeprecated?: boolean;
}
interface GraphQLNamedType {
    kind: string;
    name: string;
    description?: string | null;
    fields?: GraphQLFieldInfo[];
    inputFields?: GraphQLArg[];
    enumValues?: Array<{
        name: string;
    }>;
}
interface IntrospectedSchema {
    queryType?: string;
    mutationType?: string;
    subscriptionType?: string;
    /** Every named type, keyed by name, for resolving arg/field types during generation. */
    types: Map<string, GraphQLNamedType>;
}
interface IntrospectionResult {
    schema: IntrospectedSchema;
    /** Raw `__schema` payload, kept for callers that want more than this module parses. */
    raw: any;
}
/**
 * Auto-fetch a GraphQL server's schema via the standard introspection query.
 * This is the GraphQL analogue of the gRPC reflection handshake: one round
 * trip yields every operation the endpoint exposes.
 */
declare function introspectSchema(endpoint: string, init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
}): Promise<IntrospectionResult>;

interface GeneratedOperation {
    operationType: "query" | "mutation" | "subscription";
    fieldName: string;
    operationName: string;
    /** Complete, ready-to-send document. */
    query: string;
    /** JSON Schema describing the `variables` object, for sampling and for documentation. */
    variablesSchema: {
        type: "object";
        properties: Record<string, any>;
        required: string[];
    };
    notes: string[];
}
/**
 * Generate a complete, runnable operation document plus a variables schema
 * for one root field (a query, mutation or subscription).
 *
 * This is the GraphQL analogue of the gRPC adapter's `buildMessageTemplate`:
 * a schema was just fetched, and this turns it into something a caller can
 * send immediately without hand-writing GraphQL.
 */
declare function generateOperation(operationType: "query" | "mutation" | "subscription", field: {
    name: string;
    args: GraphQLArg[];
    type: GraphQLTypeRef;
}, schema: IntrospectedSchema): GeneratedOperation;
/** Enumerate every generatable operation across Query/Mutation/Subscription. */
declare function generateAllOperations(schema: IntrospectedSchema): GeneratedOperation[];

interface WriteGraphQLOptions {
    /** Overwrite an existing path for the same operation. Defaults to true. */
    overwrite?: boolean;
    /** Extra headers to send with the introspection request (auth, etc.). */
    headers?: Record<string, string>;
    signal?: AbortSignal;
}
/**
 * "Upload" step: merge generated GraphQL operations into `spec.paths` as
 * synthetic POST operations carrying an `x-graphql` extension. Each becomes
 * independently addressable via `locateOperation({ operationId })`, exactly
 * like any hand-authored REST operation — this is what lets `send()` resolve
 * to the GraphQL adapter afterward.
 */
declare function writeGraphQLOperations(spec: any, endpoint: string, operations: GeneratedOperation[], options?: WriteGraphQLOptions): any;
interface DiscoverAndWriteResult {
    spec: any;
    operations: GeneratedOperation[];
    warnings: string[];
}
/**
 * One-shot "auto-fetch query + upload": introspect the live schema, generate
 * a runnable document for every query/mutation/subscription field, and merge
 * the results into the document. This is the GraphQL counterpart of the gRPC
 * adapter's `discover()` + `buildMessageTemplate()` pair, collapsed into a
 * single call because GraphQL introspection already returns the whole schema
 * in one round trip.
 */
declare function discoverAndWriteGraphQLSchema(spec: any, endpoint: string, options?: WriteGraphQLOptions): Promise<DiscoverAndWriteResult>;

interface GraphQLPlan {
    config: ResolvedGraphQLConfig;
    environment: Record<string, any>;
}
/**
 * GraphQL adapter.
 *
 * An operation is claimed when it declares `x-protocol: graphql`, carries an
 * `x-graphql` extension (normally produced by
 * {@link writeGraphQLOperations}), or the caller passes `options.graphql`.
 * GraphQL is transported over plain HTTP, but the request/response shape
 * (a single query document plus a data/errors envelope) does not fit the
 * Postman-collection pipeline the HTTP adapter is built around, so it gets
 * its own adapter — the same reasoning that gives WebSocket its own.
 */
declare class GraphQLAdapter implements ProtocolAdapter<GraphQLPlan> {
    readonly name = "graphql";
    supports(ctx: AdapterContext): number;
    plan(ctx: AdapterContext): GraphQLPlan;
    execute(plan: GraphQLPlan, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;
}

interface ResolvedMcpConfig {
    endpoint: string;
    method: string;
    /** Fully-formed JSON-RPC `params` for `method`. */
    params: Record<string, unknown>;
    headers: Record<string, string>;
    sessionId?: string;
    clientInfo: {
        name: string;
        version: string;
    };
}
/**
 * Resolve the effective MCP call.
 *
 * Precedence: `options.mcp.*` (per-call override) > `operation['x-mcp'].*`
 * (the document's declared capability, normally produced by
 * {@link writeMcpOperations}).
 */
declare function resolveMcpConfig(located: LocatedOperation, spec: any, options: SendOptions): ResolvedMcpConfig;

declare const MCP_PROTOCOL_VERSION = "2025-06-18";
interface McpTool {
    kind: "tool";
    name: string;
    description?: string;
    inputSchema: any;
}
interface McpResource {
    kind: "resource";
    /** Resource templates use `uriTemplate`; concrete resources use `uri`. */
    uri?: string;
    uriTemplate?: string;
    name: string;
    description?: string;
    mimeType?: string;
}
interface McpPrompt {
    kind: "prompt";
    name: string;
    description?: string;
    arguments?: Array<{
        name: string;
        description?: string;
        required?: boolean;
    }>;
}
type McpCapability = McpTool | McpResource | McpPrompt;
interface McpDiscoveryResult {
    serverInfo?: {
        name: string;
        version: string;
    };
    protocolVersion?: string;
    sessionId?: string;
    capabilities: McpCapability[];
    warnings: string[];
}
/**
 * Handshake with an MCP server and establish a session.
 * Every MCP interaction begins here: `initialize` negotiates the protocol
 * version and capabilities, and the client must follow up with the
 * `notifications/initialized` notification before issuing any other call.
 */
declare function initializeSession(endpoint: string, init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    clientInfo?: {
        name: string;
        version: string;
    };
}): Promise<{
    sessionId?: string;
    serverInfo?: {
        name: string;
        version: string;
    };
    protocolVersion?: string;
}>;
/**
 * Auto-fetch everything an MCP server exposes: tools, resources, resource
 * templates and prompts. This is the MCP analogue of gRPC's reflection
 * `discover()` and GraphQL's schema introspection — one call that hands back
 * every operation the endpoint can perform.
 */
declare function discoverMcpCapabilities(endpoint: string, options?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    clientInfo?: {
        name: string;
        version: string;
    };
}): Promise<McpDiscoveryResult>;

interface GeneratedMcpCall {
    capability: McpCapability;
    /** JSON-RPC method for this capability. */
    method: "tools/call" | "resources/read" | "prompts/get";
    /** Sampled params, ready to send as-is or edit. */
    params: Record<string, unknown>;
    /** JSON Schema describing the editable portion of `params`. */
    argumentsSchema: any;
    notes: string[];
}
/**
 * Turn one discovered capability into a runnable call, sampling its
 * argument schema the same way the HTTP adapter samples request bodies.
 * This is the MCP counterpart of the gRPC adapter's `buildMessageTemplate`.
 */
declare function generateMcpCall(capability: McpCapability): GeneratedMcpCall;
declare function generateAllMcpCalls(capabilities: McpCapability[]): GeneratedMcpCall[];

interface WriteMcpOptions {
    /** Overwrite an existing path for the same capability. Defaults to true. */
    overwrite?: boolean;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    clientInfo?: {
        name: string;
        version: string;
    };
}
/**
 * "Upload" step: merge generated MCP calls into `spec.paths` as synthetic
 * POST operations carrying an `x-mcp` extension, each independently
 * addressable via `locateOperation({ operationId })` — the MCP counterpart of
 * {@link writeGraphQLOperations}.
 */
declare function writeMcpOperations(spec: any, endpoint: string, calls: GeneratedMcpCall[], options?: WriteMcpOptions): any;
interface DiscoverAndWriteMcpResult {
    spec: any;
    capabilities: McpCapability[];
    warnings: string[];
}
/**
 * One-shot "auto-fetch + upload" for MCP: handshake, list every tool,
 * resource and prompt the server exposes, sample arguments for each, and
 * merge the results into the document.
 */
declare function discoverAndWriteMcpCapabilities(spec: any, endpoint: string, options?: WriteMcpOptions): Promise<DiscoverAndWriteMcpResult>;

interface McpPlan {
    config: ResolvedMcpConfig;
    environment: Record<string, any>;
}
/**
 * MCP (Model Context Protocol) adapter, using the Streamable HTTP transport.
 *
 * An operation is claimed when it declares `x-protocol: mcp`, carries an
 * `x-mcp` extension (normally produced by {@link writeMcpOperations}), or the
 * caller passes `options.mcp`. Like GraphQL, MCP is one JSON-RPC call over
 * plain HTTP rather than a Postman-shaped request/response, so it gets its
 * own adapter instead of routing through the HTTP one.
 */
declare class McpAdapter implements ProtocolAdapter<McpPlan> {
    readonly name = "mcp";
    supports(ctx: AdapterContext): number;
    plan(ctx: AdapterContext): McpPlan;
    execute(plan: McpPlan, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;
}

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

export { AdapterContext, AdapterRegistry, BUILTIN_CAPTURE_TEST, type DebuggerOptions, type DiscoverAndWriteResult as DiscoverAndWriteGraphQLResult, type DiscoverAndWriteMcpResult, ExecResult, ExecuteContext, type GeneratedMcpCall, type GeneratedOperation, GraphQLAdapter, type GraphQLArg, type GraphQLFieldInfo, type GraphQLNamedType, type GraphQLTypeRef, INTROSPECTION_QUERY, type IntrospectedSchema, type IntrospectionResult, Json, LocatedOperation, MCP_PROTOCOL_VERSION, McpAdapter, type McpCapability, type McpDiscoveryResult, type McpPrompt, type McpResource, type McpTool, OperationTarget, type PlanResult, type ProtoKit, ProtoKitError, ProtocolAdapter, ProtocolName, ScriptSource, SendOptions, SendResult, type ToResponseOptions, type WriteBackOptions, type WriteGraphQLOptions, type WriteMcpOptions, createDebugger, discoverAndWriteGraphQLSchema, discoverAndWriteMcpCapabilities, discoverMcpCapabilities, generateAllMcpCalls, generateAllOperations, generateMcpCall, generateOperation, inferSchema, inferSchemaFromMany, initializeSession as initializeMcpSession, introspectSchema, mergeSchema, resolveGraphQLConfig, resolveMcpConfig, sampleFromSchema, toResponseObject, writeBackResponse, writeGraphQLOperations, writeMcpOperations };
