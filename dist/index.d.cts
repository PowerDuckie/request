import { E as ExecResult, P as ProtocolName, S as SendResult, O as OperationTarget, a as SendOptions, b as OpenApiDocument, M as ManualSessionOptions, A as AnyManualSession, J as Json, c as ScriptSource, G as GrpcTarget, d as GrpcEndpoint, e as GrpcManualSessionTarget, f as GrpcManualSession } from './types-C9ifzKqk.cjs';
export { g as AssertionResult, h as AuthConfig, C as Cloneable, i as CloneableError, j as ConsoleLog, k as CreateWsManualSessionOptions, D as DiscoverAndWriteResult, l as GeneratedOperation, m as GraphQLArg, n as GraphQLFieldInfo, o as GraphQLNamedType, p as GraphQLOptions, q as GraphQLTypeRef, r as GrpcCredentialsOptions, s as GrpcDescriptorSource, t as GrpcDescriptorSourceKind, u as GrpcEvent, v as GrpcEventDirection, w as GrpcManualSessionEvent, x as GrpcManualSessionState, y as GrpcMessageEvent, z as GrpcMetadataEvent, B as GrpcMetadataInput, F as GrpcMetadataOutput, H as GrpcMethodKind, I as GrpcProtoFileSource, K as GrpcReflectionSource, L as GrpcResult, N as GrpcSendOptions, Q as GrpcStatus, R as GrpcStatusEvent, T as GrpcStatusOrigin, U as GrpcTlsOptions, V as GrpcTruncatedReason, W as InitializeSessionInit, X as IntrospectedSchema, Y as IntrospectionResult, Z as JsonRpcOutcome, _ as ManualMessage, $ as ManualSession, a0 as ManualSessionKind, a1 as McpCapability, a2 as McpDiscoveryResult, a3 as McpListing, a4 as McpManualSession, a5 as McpManualSessionOptions, a6 as McpOptions, a7 as McpPrompt, a8 as McpRequestOptions, a9 as McpResource, aa as McpSessionEvent, ab as McpSessionState, ac as McpStdioSessionOptions, ad as McpTerminateOutcome, ae as McpTool, af as McpTransport, ag as ReplayRecord, ah as RequestValues, ai as RequesterOptions, aj as ResolvedGraphQLConfig, ak as ResolvedMcpConfig, al as ResolvedWsConfig, am as ResponseStartInfo, an as RuntimeRunOptions, ao as ScriptConfig, ap as ScriptOutcome, aq as ScriptReport, ar as SessionEventDTO, as as SessionState, at as SessionSubscription, au as StopReason, av as StreamEvent, aw as StreamParserOptions, ax as UnifiedSession, ay as WebSocketOptions, az as WebSocketSessionEvent, aA as WebSocketSessionState, aB as WriteGraphQLOptions, aC as WsManualSession, aD as WsSendOptions, aE as createEventHub, aF as toCloneable } from './types-C9ifzKqk.cjs';
import { P as ProtocolAdapter, A as AdapterContext, L as LocatedOperation, E as ExecuteContext } from './protocol-Dh-wN2nY.cjs';
export { l as locateOperation } from './protocol-Dh-wN2nY.cjs';
export { HttpAdapter, SseParser } from './protocols/http/index.cjs';
export { WebSocketAdapter, createWsManualSession, createWsManualSession as runWebSocketSession, createWsManualSession as wsManualSession } from './protocols/ws/index.cjs';
export { GraphQLAdapter, INTROSPECTION_QUERY, discoverAndWriteGraphQLSchema, generateAllOperations, generateOperation, introspectSchema, resolveGraphQLConfig, runGraphQL, writeGraphQLOperations } from './protocols/graphql/index.cjs';
export { M as MCP_PROTOCOL_VERSION, a as McpAdapter, c as createHttpMcpTransport, b as createMcpManualSession, d as createMcpStdioSession, e as createStdioMcpTransport, f as discoverAndWriteMcpCapabilities, g as discoverMcpCapabilities, h as generateAllMcpCalls, i as generateMcpCall, j as initializeMcpSession, b as mcpManualSession, r as resolveMcpConfig, k as runMcpManualSession, w as writeMcpOperations } from './index-1jRrFc3d.cjs';
import { D as DiscoveryResult } from './credentials-Cl0G4KpE.cjs';
export { a as DescriptorDecodeError, G as GrpcAdapter, b as GrpcDependencyBrokenError, c as GrpcDependencyMissingError, d as GrpcDiscoveredMethod, e as GrpcDiscoveredService, L as LOADER_OPTIONS, R as ReflectionProtocolError, f as ReflectionUnavailableError, g as buildCatalog, h as buildCredentials, i as buildCredentialsAsync, j as buildCredentialsChecked, k as buildCredentialsCheckedAsync, l as buildMessageTemplate, m as decodeFileDescriptorProto, n as decodeFileDescriptorSet, o as deriveIncludeDirsDetailed, p as discoverGrpc, q as fetchDescriptorSet, r as fetchFullDescriptorSet, s as grpcCall, p as grpcDiscover, t as isGrpcAvailable, u as listServices, v as listServicesDetailed, w as loadGrpc, x as requireCapability, y as resolveMethod, z as scanProtoFiles, A as serializeDescriptorSet } from './credentials-Cl0G4KpE.cjs';
import '@grpc/grpc-js';
import '@grpc/proto-loader';

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
 * The full-featured debugger entry: adapter registry + protocol dispatch +
 * OpenAPI write-back pipeline, plus `sendMany` and `toCollection`.
 *
 * `createClient` in "./client" is the UI-first surface (prepare/connect/
 * discover); this one stays as the workhorse for scripted flows. Both share
 * the same adapters and the same write-back machinery.
 */

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

/**
 * Decide, from the spec and caller intent, whether the operation is expected
 * to stream. A caller-supplied Accept header wins, then an explicit
 * `x-protocol` extension, then the declared response media types.
 */
declare function isStreamingOperation(operation: any, values?: {
    header?: Record<string, unknown>;
}): boolean;
declare function isSseContentType(contentType?: string): boolean;
declare function isStreamingContentType(contentType?: string): boolean;
/**
 * Build an Accept header from the declared response media types.
 *
 * Only successful responses contribute: advertising an error media type such as
 * `application/problem+json` would distort content negotiation. Streaming types
 * are listed first so a server that offers both variants picks the stream.
 */
declare function acceptHeaderFor(operation: any): string | undefined;
/**
 * Fire a real probe request and classify the live response as stream or not.
 *
 * The caller keeps ownership of `response` — this is deliberately not a HEAD
 * helper: many streaming servers answer GET with `text/event-stream` but HEAD
 * with an empty 200, so the probe uses the same request the real call will
 * make. UI flows use it to pre-select the renderer before committing to a
 * session.
 */
declare function probeStreamingResponse(input: RequestInfo | URL, init?: RequestInit): Promise<{
    ok: boolean;
    status: number;
    contentType?: string;
    kind: "none" | "sse" | "ndjson" | "chunked";
    response: Response;
}>;

/** How the UI should render this call. */
type DisplayMode = "response" | "event-list" | "duplex-session";
/** Precise streaming taxonomy used to pick a renderer / message schema. */
type StreamKind = "none" | "sse" | "ndjson" | "chunked" | "websocket" | "graphql-stream" | "grpc-unary" | "grpc-server-stream" | "grpc-client-stream" | "grpc-bidi" | "mcp-http-stream" | "mcp-stdio";
interface PreparedRequest {
    protocol: string;
    transport: string;
    target?: OperationTarget;
    operation?: any;
    display: {
        mode: DisplayMode;
    };
    stream: {
        kind: StreamKind;
        expected: boolean;
    };
    openapi: {
        extensions: Record<string, unknown>;
    };
    warnings: string[];
}
interface CreateClientOptions {
    writeBack?: WriteBackOptions;
    response?: ToResponseOptions;
}
declare function createClient(options?: CreateClientOptions): {
    prepare: (sendOptions: SendOptions) => PreparedRequest;
    send: (sendOptions: SendOptions) => Promise<SendResult>;
    sendMany: (spec: OpenApiDocument, targets: Array<{
        target: OperationTarget;
    } & Partial<Omit<SendOptions, "spec" | "target">>>, shared?: Partial<Omit<SendOptions, "spec" | "target">>) => Promise<SendManyResult>;
    connect: (connectOptions: ManualSessionOptions) => AnyManualSession;
    discover: (discoverOptions: any) => Promise<any>;
    writeback: (spec: OpenApiDocument, prepared: PreparedRequest, result: SendResult, writeOptions?: Partial<WriteBackOptions>) => OpenApiDocument;
    dispose: () => void;
    probeStreamingResponse: typeof probeStreamingResponse;
};
type ProtoClient = ReturnType<typeof createClient>;

/**
 * Unified manual-session entry.
 *
 * `createManualSession(options)` routes by `options.kind` to the matching
 * protocol factory (WebSocket / MCP / gRPC). The factories themselves stay
 * protocol-specific so their richer contracts are preserved; this entry is
 * for callers that want one surface across all three.
 */

declare function createManualSession(options: ManualSessionOptions): AnyManualSession;

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

/**
 * Create a manual gRPC session.
 *
 * The factory is synchronous and performs no I/O: descriptor loading (proto
 * files or reflection) happens lazily inside `open()`. This keeps the manual
 * session contract uniform across protocols — construct first, drive later —
 * and avoids a constructor that can throw network errors.
 */
declare function createGrpcManualSession(target: GrpcManualSessionTarget): GrpcManualSession;

export { AdapterContext, AdapterRegistry, AnyManualSession, BUILTIN_CAPTURE_TEST, type CreateClientOptions, type DebuggerOptions, type DisplayMode, ExecResult, ExecuteContext, DiscoveryResult as GrpcDiscoveryResult, GrpcEndpoint, GrpcManualSession, GrpcManualSessionTarget, GrpcProtocolAdapter, GrpcTarget, Json, LocatedOperation, ManualSessionOptions, OpenApiDocument, OperationTarget, type PlanResult, type PreparedRequest, type ProtoClient, type ProtoKit, ProtoKitError, ProtocolAdapter, ProtocolName, ScriptSource, type SendManyFailure, type SendManyResult, SendOptions, SendResult, type StreamKind, type ToResponseOptions, type WriteBackOptions, acceptHeaderFor, createClient, createDebugger, createGrpcManualSession, createManualSession, discoverAndWriteGrpcOperations, createGrpcManualSession as grpcManualSession, inferSchema, inferSchemaFromMany, isSseContentType, isStreamingContentType, isStreamingOperation, mergeSchema, probeStreamingResponse, sampleFromSchema, toResponseObject, writeBackResponse, writeGrpcOperations };
