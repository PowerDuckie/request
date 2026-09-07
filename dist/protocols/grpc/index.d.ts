import * as _grpc_grpc_js from '@grpc/grpc-js';
import * as _grpc_proto_loader from '@grpc/proto-loader';

type GrpcMethodKind = "unary" | "server_streaming" | "client_streaming" | "bidi_streaming";
interface GrpcTlsOptions {
    rootCerts?: Buffer;
    privateKey?: Buffer;
    certChain?: Buffer;
    /**
     * Skips hostname verification only. The certificate chain is STILL verified.
     * Use for self-signed certs issued to a different name.
     */
    skipHostnameVerification?: boolean;
}
interface GrpcCredentialsOptions {
    /** false/undefined = insecure; true = TLS with system roots; object = custom. */
    tls?: boolean | GrpcTlsOptions;
}
interface GrpcProtoSource {
    /** .proto files or directories. Directories are walked recursively and merged. */
    protoPaths?: string[];
    /** Import roots. Defaults to protoPaths plus each discovered file's own directory. */
    includeDirs?: string[];
    /** Directory names skipped while walking. Default: node_modules,.git,dist,build */
    ignoreDirs?: string[];
    /** Follow symlinked directories while walking. Default false. */
    followSymlinks?: boolean;
    /** Use server reflection as the descriptor source. Takes precedence over protoPaths. */
    reflection?: boolean;
    /** Deadline for the reflection handshake only. Default 5000. */
    reflectionTimeoutMs?: number;
    /** Pin a reflection version. Default: try v1, fall back to v1alpha on UNIMPLEMENTED. */
    reflectionVersion?: "v1" | "v1alpha";
}
/** Everything needed to reach a server, without naming a method. */
interface GrpcEndpoint extends GrpcProtoSource, GrpcCredentialsOptions {
    /** host:port, no scheme. */
    address: string;
    metadata?: Record<string, string | string[]>;
    channelOptions?: Record<string, unknown>;
}
interface GrpcTarget extends GrpcEndpoint {
    /** Fully-qualified service name, e.g. "demo.echo.Echo". */
    service: string;
    /** Method name as declared in proto, e.g. "Say". */
    method: string;
    /** Per-call deadline in ms. Maps to a gRPC deadline, not an abort. */
    deadlineMs?: number;
}
interface GrpcSendOptions {
    /**
     * Request payloads, in proto3 JSON shape.
     * unary / server_streaming: only messages[0] is sent; extras produce a warning.
     * client_streaming / bidi_streaming: all are sent in order.
     */
    messages?: unknown[];
    /** Stop after N inbound messages. Sets truncated=true. */
    maxMessages?: number;
    /** No inbound message for this long -> stop. Sets truncated=true. */
    idleTimeoutMs?: number;
    /** Hard wall-clock cap on the whole call. Sets truncated=true. */
    maxSessionMs?: number;
    /** Pause between outbound messages for client/bidi streaming. */
    sendIntervalMs?: number;
    /**
     * bidi only. When true the write side stays open after the last message,
     * so termination must come from the server or from a limit.
     */
    keepWriteOpen?: boolean;
    signal?: AbortSignal;
    onEvent?: (event: GrpcEvent) => void;
}
type GrpcEventDirection = "outbound" | "inbound" | "meta";
interface GrpcEvent {
    seq: number;
    direction: GrpcEventDirection;
    /** epoch ms */
    at: number;
    payload?: unknown;
    /** Present on the initial-metadata event. */
    metadata?: Record<string, string | string[]>;
    /** Present on the terminal status event. */
    status?: GrpcStatus;
}
interface GrpcStatus {
    code: number;
    /** e.g. "OK", "DEADLINE_EXCEEDED" */
    codeName: string;
    details?: string;
}
type GrpcTruncatedReason = "max_messages" | "idle_timeout" | "max_session" | "aborted";
interface GrpcResult {
    protocol: "grpc";
    kind: GrpcMethodKind;
    target: GrpcTarget;
    events: GrpcEvent[];
    /** Convenience view: inbound payloads in arrival order. */
    messages: unknown[];
    status?: GrpcStatus;
    trailers?: Record<string, string | string[]>;
    truncated: boolean;
    truncatedReason?: GrpcTruncatedReason;
    error?: string;
    warnings: string[];
    durationMs: number;
}

declare const LOADER_OPTIONS: {
    readonly keepCase: true;
    readonly longs: StringConstructor;
    readonly enums: StringConstructor;
    readonly defaults: true;
    readonly oneofs: true;
};
type SymbolKind = "service" | "message" | "enum";
interface SymbolEntry {
    kind: SymbolKind;
    /** Raw DescriptorProto / EnumDescriptorProto / ServiceDescriptorProto. */
    type: unknown;
}
interface Catalog {
    source: "proto" | "reflection";
    /** Fully-qualified name (no leading dot) -> entry. */
    symbols: Map<string, SymbolEntry>;
    /** Service names in declaration-independent sorted order. */
    services: string[];
    /** Non-fatal notes worth surfacing to the user. */
    notes: string[];
    /** Files loaded, when source === "proto". */
    files?: string[];
}
/**
 * Builds a catalog from either a local proto tree or server reflection.
 * These are the only two sources of truth; there is no editable intermediate
 * document, because .proto already is the authoritative IDL for gRPC.
 */
declare function buildCatalog(endpoint: GrpcEndpoint): Promise<{
    catalog: Catalog;
    packageDefinition: Record<string, unknown>;
}>;

interface OneofHint {
    /** Dot path of the containing message; "" means the root message. */
    at: string;
    oneof: string;
    /** Field names in this oneof. Exactly one may be set. */
    branches: string[];
    /** Which branch the generated template pre-fills. */
    chosen: string;
}
interface EnumHint {
    /** Dot path of the field. */
    at: string;
    /** Fully-qualified enum name. */
    enum: string;
    values: string[];
}
interface CollectionHint {
    at: string;
    kind: "repeated" | "map";
    /** Element / value type, for UI display. */
    of: string;
}
interface PresenceHint {
    at: string;
    /**
     * Explicit-presence field: omitting it and setting it to the zero value are
     * distinguishable on the wire, so the UI must not conflate them.
     */
    reason: "proto3_optional" | "message";
}
interface MessageTemplate {
    /** Fully-qualified message name, no leading dot. */
    message: string;
    /** Editable example in proto3 JSON shape. */
    example: Record<string, unknown>;
    oneofs: OneofHint[];
    enums: EnumHint[];
    collections: CollectionHint[];
    presence: PresenceHint[];
    /** Truncated recursion, unresolvable types, unsupported well-known types. */
    warnings: string[];
}
interface BuildTemplateOptions {
    /** Recursion cap for self-referential or deep messages. Default 4. */
    maxDepth?: number;
    /**
     * When true, repeated/map fields get one sample element so the user has
     * something to edit. When false they start empty. Default true.
     */
    seedCollections?: boolean;
}
/**
 * Builds an editable proto3-JSON example for a message.
 *
 * The shape is fixed by the descriptor and is NOT user-editable; what the user
 * edits are the values, plus four structural choices that the schema itself
 * leaves open: which oneof branch is set, whether an explicit-presence field is
 * present at all, and how many elements a repeated field or map has. Those are
 * reported as hints rather than baked into the example.
 */
declare function buildMessageTemplate(catalog: Catalog, messageName: string, options?: BuildTemplateOptions): MessageTemplate;

interface DiscoveredMethod {
    /** Method name as declared in proto. */
    name: string;
    /** "/pkg.Service/Method" */
    path: string;
    kind: GrpcMethodKind;
    /** Fully-qualified request message name. */
    inputType: string;
    /** Fully-qualified response message name. */
    outputType: string;
    requestStream: boolean;
    responseStream: boolean;
}
interface DiscoveredService {
    /** Fully-qualified service name. */
    name: string;
    /** Proto package, "" when the service is at the top level. */
    package: string;
    methods: DiscoveredMethod[];
}
interface DiscoveryResult {
    address: string;
    source: "proto" | "reflection";
    services: DiscoveredService[];
    /** Files loaded, when source === "proto". */
    files?: string[];
    notes: string[];
}
/**
 * Lists every service and method reachable from the endpoint, from the local
 * proto tree or from server reflection. This is the discovery half of the
 * Postman workflow: pick a method, then fill in values.
 */
declare function discover(endpoint: GrpcEndpoint): Promise<DiscoveryResult>;
interface MethodDetail extends DiscoveredMethod {
    service: string;
    /** Editable request body plus the structural choices the schema leaves open. */
    request?: MessageTemplate;
    /** Shape of the response, for display. */
    response?: MessageTemplate;
    notes: string[];
}
/**
 * Discovery plus a generated request template, i.e. everything needed to render
 * a request editor for one method.
 */
declare function describeMethod(endpoint: GrpcEndpoint, service: string, method: string, options?: {
    includeResponse?: boolean;
    maxDepth?: number;
}): Promise<MethodDetail>;
declare function describeFromCatalog(catalog: Catalog, packageDefinition: Record<string, unknown>, service: string, method: string, options?: {
    includeResponse?: boolean;
    maxDepth?: number;
}): MethodDetail;

interface GrpcPlan {
    collection: unknown;
    environment: unknown;
    warnings: string[];
    streaming: boolean;
}
declare class GrpcAdapter {
    readonly protocol: "grpc";
    supports(target: unknown): boolean;
    plan(target: unknown): Promise<GrpcPlan>;
    run(target: unknown, options: unknown): Promise<GrpcResult>;
    /** Not part of ProtocolAdapter; exposed for discovery UIs. */
    discover(endpoint: GrpcEndpoint): Promise<DiscoveryResult>;
    describeMethod(endpoint: GrpcEndpoint, service: string, method: string): Promise<MethodDetail>;
}

/**
 * Invokes one gRPC method. All four streaming kinds converge on a single event
 * log and a single set of termination conditions.
 */
declare function grpcCall(target: GrpcTarget, options?: GrpcSendOptions): Promise<GrpcResult>;

interface ResolvedMethod {
    kind: GrpcMethodKind;
    /** "/pkg.Service/Method" */
    path: string;
    requestStream: boolean;
    responseStream: boolean;
    serialize: (value: unknown) => Buffer;
    deserialize: (buffer: Buffer) => unknown;
    /** How the descriptor was obtained. */
    source: "proto" | "reflection";
    /** Non-fatal notes worth surfacing. */
    notes: string[];
}
/**
 * Resolves one method to the codecs and streaming flags needed to invoke it.
 *
 * The streaming kind has exactly one source — the descriptor — and is never
 * accepted from the caller, so a mismatch between declaration and runtime
 * behaviour is not representable.
 */
declare function resolveMethod(target: GrpcTarget): Promise<ResolvedMethod>;

interface CollectProtoOptions {
    paths: string[];
    ignoreDirs?: string[];
    followSymlinks?: boolean;
}
/**
 * Expands a mix of files and directories into a de-duplicated, sorted list of
 * absolute .proto paths.
 *
 * The sort is load-order significant: when two files declare the same
 * fully-qualified symbol, proto-loader silently lets the later one win, so a
 * stable order is what makes such a conflict reproducible instead of flaky.
 */
declare function collectProtoFiles(options: CollectProtoOptions): Promise<string[]>;
/**
 * Derives include dirs so that `import "common/types.proto"` resolves.
 * A bare directory scan without this loads files that cannot resolve their own
 * imports. Explicit includeDirs from the caller always take precedence.
 */
declare function deriveIncludeDirs(protoFiles: string[], roots: string[]): string[];

interface ReflectionSessionOptions {
    address: string;
    credentials: unknown;
    metadata?: Record<string, string | string[]>;
    timeoutMs?: number;
    channelOptions?: Record<string, unknown>;
    version?: "v1" | "v1alpha";
}
/** FileDescriptorSet { repeated FileDescriptorProto file = 1; } */
declare function serializeDescriptorSet(descriptors: Map<string, Buffer>): Buffer;
/** Service names exposed by the server, excluding the reflection service itself. */
declare function listServices(options: ReflectionSessionOptions): Promise<string[]>;
/** Transitive descriptor closure for the given symbols, merged and de-duplicated. */
declare function fetchDescriptorSet(options: ReflectionSessionOptions & {
    symbols: string[];
}): Promise<Buffer>;
/** Lists services, then fetches the descriptor closure for all of them. */
declare function fetchFullDescriptorSet(options: ReflectionSessionOptions): Promise<{
    services: string[];
    descriptorSet: Buffer;
}>;

type GrpcJs = typeof _grpc_grpc_js;
type ProtoLoader = typeof _grpc_proto_loader;
interface LoadedGrpc {
    grpc: GrpcJs;
    protoLoader: ProtoLoader;
}

declare function buildCredentials(source: GrpcCredentialsOptions, { grpc }: LoadedGrpc): _grpc_grpc_js.ChannelCredentials;
declare function buildCredentialsAsync(source: GrpcCredentialsOptions): Promise<_grpc_grpc_js.ChannelCredentials>;

export { type BuildTemplateOptions, type Catalog, type CollectProtoOptions, type CollectionHint, type DiscoveredMethod, type DiscoveredService, type DiscoveryResult, type EnumHint, GrpcAdapter, type GrpcCredentialsOptions, type GrpcEndpoint, type GrpcEvent, type GrpcEventDirection, type GrpcMethodKind, type GrpcPlan, type GrpcProtoSource, type GrpcResult, type GrpcSendOptions, type GrpcStatus, type GrpcTarget, type GrpcTlsOptions, type GrpcTruncatedReason, LOADER_OPTIONS, type MessageTemplate, type MethodDetail, type OneofHint, type PresenceHint, type ReflectionSessionOptions, type ResolvedMethod, type SymbolEntry, type SymbolKind, buildCatalog, buildCredentials, buildCredentialsAsync, buildMessageTemplate, collectProtoFiles, deriveIncludeDirs, describeFromCatalog, describeMethod, discover, fetchDescriptorSet, fetchFullDescriptorSet, grpcCall, listServices, resolveMethod, serializeDescriptorSet };
