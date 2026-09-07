import * as _grpc_grpc_js from '@grpc/grpc-js';
import * as _grpc_proto_loader from '@grpc/proto-loader';

/**
 * Derived from the descriptor, never accepted from the caller.
 *
 * Picking the wrong one is not a recoverable guess: it decides whether the
 * write side must be half-closed and whether inbound messages are expected at
 * all, so a mismatch produces a hang rather than an error.
 */
type GrpcMethodKind = "unary" | "server_streaming" | "client_streaming" | "bidi_streaming";
interface GrpcTlsOptions {
    /**
     * CA bundle contents, not a path. Pass `await readFile(p)`; a string is
     * rejected, because grpc-js would otherwise treat the path text itself as
     * PEM data and fail with an opaque handshake error.
     */
    rootCerts?: Buffer;
    /** Client key for mTLS. Must be given together with certChain. */
    privateKey?: Buffer;
    /** Client certificate chain for mTLS. Must be given together with privateKey. */
    certChain?: Buffer;
    /**
     * Skips hostname verification only. The certificate chain is STILL verified.
     * For self-signed certs issued to a different name. Always produces a warning.
     */
    skipHostnameVerification?: boolean;
}
interface GrpcCredentialsOptions {
    /** false/undefined = insecure; true = TLS with system roots; object = custom. */
    tls?: boolean | GrpcTlsOptions;
}
interface GrpcProtoFileSource {
    reflection?: false;
    /** .proto files or directories. Directories are walked recursively and merged. */
    protoPaths: string[];
    /**
     * Import roots. When omitted they are derived from protoPaths plus, for files
     * outside them, each file's own directory — which resolves imports more
     * loosely than protoc and is reported as a note. Set this for exact parity
     * with your build.
     */
    includeDirs?: string[];
    /** Directory names skipped while walking. Default: node_modules,.git,dist,build,out,.venv */
    ignoreDirs?: string[];
    /** Follow symlinks while walking. Default false; cycles are detected either way. */
    followSymlinks?: boolean;
    /** Cap on files collected in one scan. Default 5000. */
    maxProtoFiles?: number;
}
interface GrpcReflectionSource {
    /** Use server reflection as the descriptor source. */
    reflection: true;
    /** Budget for the whole reflection session, not per round trip. Default 5000. */
    reflectionTimeoutMs?: number;
    /** Pin a version. Default: try v1, fall back to v1alpha when unimplemented. */
    reflectionVersion?: "v1" | "v1alpha";
    /** `host` field on reflection requests. Only for virtual-hosted servers. */
    reflectionHost?: string;
    /** Caps on the descriptor closure. Defaults: 2000 files, 32 MiB. */
    maxReflectionFiles?: number;
    maxReflectionBytes?: number;
}
/**
 * Exactly one descriptor source. `.proto` is already the authoritative IDL for
 * gRPC, and a running server can describe itself — there is no third option and
 * no lossy intermediate document worth introducing.
 */
type GrpcDescriptorSource = GrpcProtoFileSource | GrpcReflectionSource;
/**
 * Metadata as written by a caller. Single values are allowed because writing
 * `{ "x-trace": "abc" }` is what people mean.
 */
type GrpcMetadataInput = Record<string, string | string[]>;
/**
 * Metadata as observed on the wire. Always arrays: HTTP/2 headers may repeat,
 * and collapsing repeats would silently discard data. Binary (`-bin`) values
 * are base64-encoded so the result stays JSON-serialisable.
 */
type GrpcMetadataOutput = Record<string, string[]>;
interface GrpcConnection extends GrpcCredentialsOptions {
    /** host:port, no scheme. */
    address: string;
    /** Sent on every call made through this endpoint, including reflection. */
    metadata?: GrpcMetadataInput;
    channelOptions?: Record<string, unknown>;
}
/** Everything needed to reach a server and read its schema, without a method. */
type GrpcEndpoint = GrpcConnection & GrpcDescriptorSource;
/** An endpoint plus the one method to invoke. */
type GrpcTarget = GrpcEndpoint & {
    /** Fully-qualified service name, e.g. "demo.echo.Echo". */
    service: string;
    /** Method name as declared in proto, e.g. "Say". Matched case-insensitively as a fallback. */
    method: string;
    /**
     * Per-call gRPC deadline. Enforced by the server, so exceeding it yields
     * DEADLINE_EXCEEDED with statusOrigin "server" and truncated=false — the call
     * was not cut short by this library.
     */
    deadlineMs?: number;
};
interface GrpcSendOptions {
    /**
     * Request payloads, in proto3 JSON shape as produced by buildMessageTemplate.
     *
     * unary / server_streaming: only messages[0] is sent; extras produce a
     *   warning. When omitted an empty message is sent, which a method with
     *   required semantics will reject — a warning says so.
     * client_streaming / bidi_streaming: all are sent in order, then the write
     *   side is half-closed unless keepWriteOpen is set.
     */
    messages?: unknown[];
    /**
     * Stop after N inbound messages. 0 means "send, then stop before reading".
     * Sets truncated=true with reason "max_messages".
     */
    maxMessages?: number;
    /** No inbound message for this long -> stop. Reason "idle_timeout". */
    idleTimeoutMs?: number;
    /** Hard wall-clock cap on the whole call. Reason "max_session". */
    maxSessionMs?: number;
    /**
     * All limits are armed simultaneously and the first to fire wins; only that
     * one appears in truncatedReason. They are independent of target.deadlineMs,
     * which is enforced by the server rather than here.
     */
    /** Pause between outbound messages. client/bidi streaming only. */
    sendIntervalMs?: number;
    /**
     * bidi only. Keeps the write side open after the last message, so the call
     * can only end via the server, a limit, an abort, or the deadline. Setting it
     * with none of those available produces a warning.
     */
    keepWriteOpen?: boolean;
    signal?: AbortSignal;
    /**
     * Called for every event, in order. A throwing callback is swallowed: an
     * observer must not be able to terminate the call it is observing.
     */
    onEvent?: (event: GrpcEvent) => void;
}
/**
 * "status" is its own direction rather than a flavour of "meta".
 *
 * Response headers and the terminal status are different observations — one is
 * mid-call, the other ends it — and giving them the same discriminant means a
 * `switch (event.direction)` cannot tell them apart. The terminal status is the
 * single most important event in the log, so it is the last one that should be
 * indistinguishable from anything else.
 */
type GrpcEventDirection = "outbound" | "inbound" | "meta" | "status";
interface GrpcEventBase {
    seq: number;
    /** epoch ms */
    at: number;
}
interface GrpcMessageEvent extends GrpcEventBase {
    direction: "outbound" | "inbound";
    payload: unknown;
}
/** Initial metadata, i.e. response headers. */
interface GrpcMetadataEvent extends GrpcEventBase {
    direction: "meta";
    metadata: GrpcMetadataOutput;
}
interface GrpcStatusEvent extends GrpcEventBase {
    direction: "status";
    status: GrpcStatus;
    /**
     * Always "server" or "client" here: this event records a status that was
     * actually observed. A synthesized status never produces an event, because
     * nothing happened on the wire to record — it appears only in the result.
     */
    statusOrigin: Exclude<GrpcStatusOrigin, "synthesized">;
    /** Trailing metadata, when the status arrived with any. */
    metadata?: GrpcMetadataOutput;
}
/**
 * Discriminated on `direction`, so narrowing yields exactly the fields that
 * event carries. Consumers that switch on it should end with an exhaustiveness
 * check; a missing branch is otherwise a silently blank row in a timeline.
 */
type GrpcEvent = GrpcMessageEvent | GrpcMetadataEvent | GrpcStatusEvent;
interface GrpcStatus {
    code: number;
    /** e.g. "OK", "DEADLINE_EXCEEDED". Falls back to "CODE_<n>" for unknown codes. */
    codeName: string;
    details?: string;
}
/**
 * Who produced a status.
 *
 * - "server"      : the peer's trailers, or the unary/client-streaming callback.
 * - "client"      : grpc-js decided it locally without the server replying,
 *                   e.g. UNAVAILABLE on a refused connection.
 * - "synthesized" : this library stopped the call, so no wire status will ever
 *                   arrive and CANCELLED was written in. Labelled rather than
 *                   left blank, because an unlabelled synthetic status is
 *                   indistinguishable from one the peer sent.
 */
type GrpcStatusOrigin = "server" | "client" | "synthesized";
/**
 * Why this library stopped a call that would otherwise have continued.
 *
 * That is the whole definition of `truncated`, and it is what keeps
 * target.deadlineMs off this list: a deadline is enforced by the peer, so its
 * DEADLINE_EXCEEDED is a real outcome rather than an interruption.
 */
type GrpcTruncatedReason = "max_messages" | "idle_timeout" | "max_session" | "aborted";
interface GrpcResult {
    protocol: "grpc";
    /** From the descriptor, so it reflects what the method is, not what was asked for. */
    kind: GrpcMethodKind;
    target: GrpcTarget;
    /** Everything that happened, in order, including messages already in `messages`. */
    events: GrpcEvent[];
    /** Inbound payloads only, for the common case of not needing the timeline. */
    messages: unknown[];
    /**
     * Response headers. Undefined means the call never reached the point of
     * receiving them; an empty object means they arrived and were empty.
     */
    initialMetadata?: GrpcMetadataOutput;
    /** Response trailers, with the same undefined-versus-empty distinction. */
    trailers?: GrpcMetadataOutput;
    /** Undefined only when the call was cut before any outcome existed. */
    status?: GrpcStatus;
    /** Present exactly when `status` is. */
    statusOrigin?: GrpcStatusOrigin;
    truncated: boolean;
    /** Present exactly when truncated is true. */
    truncatedReason?: GrpcTruncatedReason;
    /** Human-readable failure text. Absent on success and on clean truncation. */
    error?: string;
    warnings: string[];
    durationMs: number;
}

/**
 * Loader options are part of the contract, not an implementation detail:
 * `keepCase` decides whether request JSON keys are snake_case or camelCase, and
 * `enums`/`longs` decide the JSON form of values. template.ts derives the shape
 * it generates from these, so the two can never drift.
 */
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
    /**
     * The decoded descriptor. Always present — a symbol we cannot describe is not
     * registered at all, because an entry with an absent descriptor is exactly the
     * failure mode that made method lists silently empty.
     */
    type: unknown;
    /** File the symbol was declared in, for diagnostics. */
    file: string;
}
interface Catalog {
    source: "proto" | "reflection";
    /** Fully-qualified name (no leading dot) -> entry. Map entries excluded. */
    symbols: Map<string, SymbolEntry>;
    /** Service names known from descriptors, sorted. */
    services: string[];
    /** Service names the runtime can actually dial, sorted. */
    invocableServices: string[];
    /** Fully-qualified service name -> ServiceDescriptorProto. */
    serviceDescriptors: Map<string, unknown>;
    /** Non-fatal facts worth surfacing to the user. */
    notes: string[];
    /** Proto files loaded, or descriptor file names when source is reflection. */
    files?: string[];
}
declare function buildCatalog(endpoint: GrpcEndpoint): Promise<{
    catalog: Catalog;
    packageDefinition: Record<string, unknown>;
}>;

interface OneofHint {
    /** Dot path of the containing message; "" means the root message. */
    at: string;
    oneof: string;
    /** Field names in this oneof, in declaration order. Exactly one may be set. */
    branches: string[];
    /** Which branch the generated template pre-fills. */
    chosen: string;
    /**
     * Per-branch shape, so a UI can switch branches without re-describing the
     * method. Values are the same proto3-JSON form the example uses.
     *
     * A branch may be absent here: a message-typed branch under
     * fillMessageFields:false has no value to offer, and inventing `{}` for it
     * would claim "set with all defaults" rather than "not set".
     */
    branchValues: Record<string, unknown>;
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
    /** Map key type, for maps only. */
    keyOf?: string;
}
interface PresenceHint {
    at: string;
    /**
     * Explicit-presence field: omitting it and setting it to the zero value are
     * distinguishable on the wire, so the UI must not conflate them.
     *
     * Exactly one hint is emitted per path. An `optional` message field is
     * reported as "proto3_optional" only — two entries for one path, each with
     * its own presentInExample, would leave the UI no way to pick.
     */
    reason: "proto3_optional" | "message";
    /** Whether the generated example includes this key. */
    presentInExample: boolean;
    /**
     * Value to use if the user chooses to set it. Always computed, including when
     * the example omits the key — that is the whole purpose of the hint, and
     * re-describing the method to recover it is what these hints exist to avoid.
     */
    valueIfSet: unknown;
}
interface MessageTemplate {
    /** Fully-qualified message name, no leading dot. */
    message: string;
    /** Editable example in proto3 JSON shape. */
    example: Record<string, unknown>;
    /**
     * Which key spelling the example uses. Mirrors the loader configuration the
     * request will actually be serialised with; editing tools should not assume.
     */
    keyStyle: "declared" | "json";
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
    /**
     * When true, `optional` (explicit-presence) fields are pre-filled with their
     * zero value. Default FALSE: presence is observable on the wire, and a
     * template that silently sets every optional field would make "omitted" the
     * one state the user cannot reach by accident. The hints tell the UI what to
     * offer instead.
     */
    fillExplicitOptional?: boolean;
    /**
     * When true, singular message-typed fields are pre-filled. Message fields
     * also have explicit presence, but omitting them entirely would leave the
     * user with nothing to expand, so the default is TRUE and the presence hint
     * records that the key may be removed.
     */
    fillMessageFields?: boolean;
}
/**
 * Builds an editable proto3-JSON example for a message.
 *
 * The shape is fixed by the descriptor and is NOT user-editable; what the user
 * edits are the values, plus four structural choices the schema leaves open:
 * which oneof branch is set, whether an explicit-presence field is present at
 * all, how many elements a repeated field or map has, and (outside this
 * function) metadata / deadline / flow control. Those four are reported as
 * hints rather than baked into the example.
 */
declare function buildMessageTemplate(catalog: Catalog, messageName: string, options?: BuildTemplateOptions): MessageTemplate;

interface DiscoveredMethod {
    /** Method name as declared in proto. */
    name: string;
    /** "/pkg.Service/Method" */
    path: string;
    kind: GrpcMethodKind;
    /**
     * Fully-qualified request message name, or undefined when only the runtime
     * view was available. Undefined means "unknown", never "empty" — a template
     * cannot be generated for it.
     */
    inputType?: string;
    /** Fully-qualified response message name. See inputType. */
    outputType?: string;
    requestStream: boolean;
    responseStream: boolean;
    /** False when the method appears in the descriptor but has no runtime codec. */
    invocable: boolean;
}
interface DiscoveredService {
    /** Fully-qualified service name. */
    name: string;
    /** Proto package, "" when the service is at the top level. */
    package: string;
    methods: DiscoveredMethod[];
    /**
     * Which views contributed. "both" is the healthy case; anything else means
     * the corresponding capability is degraded and `notes` explains why.
     */
    views: "both" | "descriptor_only" | "runtime_only";
}
interface DiscoveryResult {
    address: string;
    source: "proto" | "reflection";
    services: DiscoveredService[];
    /** Files loaded, when source === "proto". */
    files?: string[];
    notes: string[];
}
interface MethodDetail extends DiscoveredMethod {
    service: string;
    /** Editable request body plus the structural choices the schema leaves open. */
    request?: MessageTemplate;
    /** Shape of the response, for display. */
    response?: MessageTemplate;
    notes: string[];
}
interface DescribeOptions {
    includeResponse?: boolean;
    maxDepth?: number;
    seedCollections?: boolean;
    fillExplicitOptional?: boolean;
    fillMessageFields?: boolean;
}
/**
 * Discovery plus a generated request template, i.e. everything needed to render
 * a request editor for one method.
 *
 * Each call rebuilds the catalog, which under reflection means a full handshake
 * per method. Callers that describe many methods should build the catalog once
 * and use `describeFromCatalog`. No cache lives here on purpose: adding one
 * later is a minor change, while shipping the wrong invalidation rule is a
 * breaking one.
 */
declare function describeMethod(endpoint: GrpcEndpoint, service: string, method: string, options?: DescribeOptions): Promise<MethodDetail>;
declare function describeFromCatalog(catalog: Catalog, packageDefinition: Record<string, unknown>, service: string, method: string, options?: DescribeOptions): MethodDetail;
/**
 * Enumerates services from an already-built catalog.
 *
 * Split out so a caller holding a catalog — the adapter's cache, or a UI that
 * already listed services — never rebuilds it just to re-enumerate. Under
 * reflection a rebuild also means observing a server that may have been
 * redeployed in between, so the two results could legitimately disagree.
 */
declare function discoverFromCatalog(endpoint: GrpcEndpoint, catalog: Catalog, packageDefinition: Record<string, unknown>): DiscoveryResult;
/** Builds a catalog for the endpoint, then enumerates it. */
declare function discover(endpoint: GrpcEndpoint): Promise<DiscoveryResult>;

interface GrpcPlan {
    collection: unknown;
    environment: unknown;
    warnings: string[];
    streaming: boolean;
}
interface CachedCatalog {
    catalog: Catalog;
    packageDefinition: Record<string, unknown>;
    at: number;
}
interface GrpcAdapterOptions {
    /**
     * How long a catalog may be reused, in ms. Default 30_000.
     *
     * A server can be redeployed with a different schema, so this is a staleness
     * budget rather than a permanent cache; 0 disables reuse entirely.
     */
    catalogTtlMs?: number;
}
declare class GrpcAdapter {
    readonly protocol: "grpc";
    private readonly catalogTtlMs;
    private readonly catalogs;
    /** In-flight builds, so concurrent first calls dial once. */
    private readonly building;
    constructor(options?: GrpcAdapterOptions);
    /**
     * True only for targets this adapter can actually process. One without a
     * descriptor source is rejected here rather than accepted and then failed in
     * plan(), because claiming support for something that always throws makes the
     * dispatcher's decision meaningless.
     */
    supports(target: unknown): boolean;
    private assertSupported;
    /** Builds or reuses the catalog for an endpoint. */
    catalogFor(endpoint: GrpcEndpoint): Promise<CachedCatalog>;
    /** Drops cached descriptors, for when the server or the proto tree changed. */
    invalidate(endpoint?: GrpcEndpoint): void;
    /**
     * Produces an export bundle for one method.
     *
     * Unlike the HTTP adapter this performs I/O — reading the proto tree, or
     * dialling the server when reflection is the source — because a gRPC method's
     * streaming kind and message shapes exist nowhere else.
     */
    plan(target: unknown): Promise<GrpcPlan>;
    run(target: unknown, options?: unknown): Promise<GrpcResult>;
    /** Not part of ProtocolAdapter; exposed for discovery UIs. */
    discover(endpoint: GrpcEndpoint): Promise<DiscoveryResult>;
    describeMethod(endpoint: GrpcEndpoint, service: string, method: string, options?: DescribeOptions): Promise<MethodDetail>;
}

/**
 * Invokes one gRPC method. All four streaming kinds converge on a single event
 * log and a single set of termination conditions.
 *
 * Transport-level failures are reported in the result rather than thrown; only
 * descriptor resolution (which happens before any bytes move) throws. The two
 * are deliberately different: one is a caller mistake, the other is an
 * observation about the world.
 *
 * This resolves the descriptor on every call, which means reading the proto
 * tree or dialling reflection each time. Calling it in a loop is therefore
 * wasteful — go through GrpcAdapter, whose catalog cache exists for that case.
 */
declare function grpcCall(target: GrpcTarget, options?: GrpcSendOptions): Promise<GrpcResult>;

interface ResolvedMethod {
    /**
     * The method name as declared in the descriptor, which may differ in case
     * from what the caller passed. Anything that records the call — exports,
     * logs, collection items — must use this rather than the input, or it will
     * record a name the server does not have.
     */
    name: string;
    kind: GrpcMethodKind;
    /** "/pkg.Service/Method" */
    path: string;
    requestStream: boolean;
    responseStream: boolean;
    serialize: (value: unknown) => Buffer;
    deserialize: (buffer: Buffer) => unknown;
    /** Fully-qualified request/response message names, when the descriptor had them. */
    inputType?: string;
    outputType?: string;
    /** How the descriptor was obtained. */
    source: "proto" | "reflection";
    /** Non-fatal notes worth surfacing. */
    notes: string[];
}
/**
 * A catalog already built for this endpoint, supplied to avoid re-reading the
 * proto tree and, under reflection, to avoid a second dial.
 *
 * Both halves are required together because they must come from ONE
 * buildCatalog call: the package definition is the runtime view and the catalog
 * is the metadata view of the same descriptors. Mixing views from two builds
 * would let the streaming cross-check below compare two different moments of
 * the server and refuse a call for a disagreement that never existed.
 */
interface ResolveMethodOptions {
    catalog: Catalog;
    packageDefinition: Record<string, unknown>;
}
/**
 * Resolves one method to the codecs and streaming flags needed to invoke it.
 *
 * Two views are consulted and both must agree. The runtime view (proto-loader's
 * package definition) is the only source of codecs and paths; the descriptor
 * view is the only source of message type names. Where they overlap — the
 * streaming flags — a disagreement means one of them is describing a different
 * method, and the call is refused rather than guessed: choosing wrongly leaves
 * a stream that should be half-closed open, or closes one that should stay open,
 * and both present as a hang instead of an error.
 *
 * Called without `options` it builds a catalog itself, which means re-reading
 * the proto tree or re-dialling for reflection on every call. That cost is
 * accepted so that `grpcCall` stays usable on its own; anything issuing more
 * than one call should build the catalog once (or go through GrpcAdapter, which
 * caches it) and pass it here.
 */
declare function resolveMethod(target: GrpcTarget, options?: ResolveMethodOptions): Promise<ResolvedMethod>;

interface CollectProtoOptions {
    paths: string[];
    /** Directory names skipped during traversal. Defaults below. */
    ignoreDirs?: string[];
    /**
     * Follow symlinks. Off by default: a link cycle is common in monorepos and
     * following one silently doubles or hangs the scan. Cycles are detected by
     * real path either way, so enabling this is safe.
     */
    followSymlinks?: boolean;
    /** Cap on files collected, to bound a mistakenly broad root. Default 5000. */
    maxFiles?: number;
}
interface ProtoScanResult {
    /** Absolute .proto paths, de-duplicated, sorted by byte order. */
    files: string[];
    /** Roots as given, resolved to absolute directories. */
    rootDirs: string[];
    /** Roots that pointed at a single file rather than a tree. */
    fileRoots: string[];
    /** Non-fatal facts: skipped links, unreadable dirs, caps hit. */
    notes: string[];
}
/**
 * Expands a mix of files and directories into a de-duplicated, sorted list of
 * absolute .proto paths.
 *
 * The sort is load-order significant: when two files declare the same
 * fully-qualified symbol, proto-loader lets one of them win without complaint,
 * so a stable order is what makes such a conflict reproducible rather than
 * dependent on directory iteration order.
 */
declare function scanProtoFiles(options: CollectProtoOptions): Promise<ProtoScanResult>;
interface IncludeDirsResult {
    includeDirs: string[];
    notes: string[];
}
/**
 * Derives include dirs so that `import "common/types.proto"` resolves.
 *
 * A bare directory scan without this loads files that cannot resolve their own
 * imports. But note what the fallback costs: adding every containing directory
 * makes `import "types.proto"` resolve from any directory in the tree, so a
 * proto that `protoc -I <root>` would reject can load here. That is a guess in
 * the user's favour, and guesses that loosen resolution have to be announced —
 * otherwise this library reports a proto tree as healthy when the real build
 * will fail. Pass includeDirs explicitly to switch the guess off.
 */
declare function deriveIncludeDirsDetailed(scan: ProtoScanResult): IncludeDirsResult;

/**
 * The server could not be asked at all: no reflection service on either
 * version. Distinct from "reflection works and the answer is empty", which
 * is a legitimate (if unhelpful) reply and must not be reported the same way.
 */
declare class ReflectionUnavailableError extends Error {
    readonly address: string;
    readonly versionsTried: readonly ReflectionVersion[];
    constructor(address: string, versionsTried: readonly ReflectionVersion[], cause?: unknown);
}
/** The reflection service answered, but the answer was an error or unusable. */
declare class ReflectionProtocolError extends Error {
    readonly detail?: string;
    constructor(message: string, detail?: string);
}
type ReflectionVersion = "v1" | "v1alpha";
interface ReflectionSessionOptions {
    address: string;
    credentials: _grpc_grpc_js.ChannelCredentials;
    metadata?: Record<string, string | string[]>;
    /** Wall-clock budget for the whole session. Default 5000. */
    timeoutMs?: number;
    channelOptions?: Record<string, unknown>;
    /** Pin a version. Omit to try v1 then fall back to v1alpha. */
    version?: ReflectionVersion;
    /** `host` field on each request. Only meaningful for virtual-hosted servers. */
    host?: string;
    /** Hard cap on files pulled in one session. Default 2000. */
    maxFiles?: number;
    /** Hard cap on total descriptor bytes. Default 32 MiB. */
    maxBytes?: number;
}
/** What the session should ask for. */
type ReflectionOp = 
/** list_services only. */
{
    kind: "list";
}
/** Descriptor closure for the given symbols. */
 | {
    kind: "symbols";
    symbols: string[];
}
/**
 * list_services, then the closure for everything it returned — on one
 * stream, so the two halves cannot disagree about what the server exposes.
 */
 | {
    kind: "list_then_symbols";
};
interface ReflectionOutcome {
    /** Present iff the op asked for a service list. */
    services?: string[];
    /** filename -> raw FileDescriptorProto bytes. */
    descriptors: Map<string, Buffer>;
    /** Which version actually answered. */
    version: ReflectionVersion;
    /** Non-fatal facts the caller should surface. */
    notes: string[];
}
/**
 * Serialises files in dependency order.
 *
 * FileDescriptorSet { repeated FileDescriptorProto file = 1; }
 *
 * Map iteration order reflects the order the server happened to answer in,
 * which is not stable across runs. Sorting topologically makes the output
 * byte-for-byte reproducible and puts every file after the files it imports,
 * which is what descriptor consumers expect.
 */
declare function serializeDescriptorSet(descriptors: Map<string, Buffer>): Buffer;
interface ListServicesResult {
    /** Service names, excluding the reflection service itself. */
    services: string[];
    version: ReflectionVersion;
    notes: string[];
}
/**
 * Service names exposed by the server.
 *
 * An empty array is a legitimate answer: it means reflection works and the
 * server registered nothing. That is a different fact from "the server has
 * no reflection service", which throws ReflectionUnavailableError, and callers
 * must not collapse the two into one message.
 */
declare function listServicesDetailed(options: ReflectionSessionOptions): Promise<ListServicesResult>;
/** Convenience wrapper for callers that only want the names. */
declare function listServices(options: ReflectionSessionOptions): Promise<string[]>;
interface DescriptorSetResult {
    /** Serialised FileDescriptorSet, in dependency order. */
    descriptorSet: Buffer;
    /** Filenames included, in the same order. */
    files: string[];
    version: ReflectionVersion;
    notes: string[];
}
/** Transitive descriptor closure for the given symbols, merged and de-duplicated. */
declare function fetchDescriptorSet(options: ReflectionSessionOptions & {
    symbols: string[];
}): Promise<DescriptorSetResult>;
interface FullDescriptorSetResult extends DescriptorSetResult {
    services: string[];
}
/**
 * Lists services and fetches their descriptor closure over a single stream.
 *
 * Doing both on one call is not just an optimisation: two separate sessions can
 * observe two different server states, so the service list could name a service
 * whose descriptors the second session never asked for.
 */
declare function fetchFullDescriptorSet(options: ReflectionSessionOptions): Promise<FullDescriptorSetResult>;

/**
 * Minimal protobuf wire decoder for descriptor.proto.
 *
 * Why hand-rolled: the descriptor bytes arrive from two places — a reflection
 * response and proto-loader's `fileDescriptorProtos` — and both must produce
 * one identical symbol table. Decoding them ourselves is the only way to
 * guarantee that without depending on proto-loader internals (the previous
 * implementation matched on its private `format` string, which meant a service
 * could vanish from the catalog without any error).
 *
 * Output convention: plain objects with snake_case keys, matching
 * descriptor.proto field names. Repeated containers are ALWAYS present (empty
 * array when absent) so downstream shape guards can distinguish "no methods"
 * from "not a descriptor at all". Enums stay numeric; the readers in
 * descriptor-types.ts normalise them.
 */
declare class DescriptorDecodeError extends Error {
    constructor(message: string);
}
interface DecodedFile {
    name?: string;
    package?: string;
    syntax?: string;
    dependency: string[];
    message_type: DecodedMessage[];
    enum_type: DecodedEnum[];
    service: DecodedService[];
}
interface DecodedMessage {
    name: string;
    field: DecodedField[];
    nested_type: DecodedMessage[];
    enum_type: DecodedEnum[];
    oneof_decl: {
        name: string;
    }[];
    options: {
        map_entry: boolean;
    };
}
interface DecodedField {
    name: string;
    number: number;
    label: number;
    type: number;
    type_name?: string;
    json_name?: string;
    oneof_index?: number;
    proto3_optional: boolean;
}
interface DecodedEnum {
    name: string;
    value: {
        name: string;
        number: number;
    }[];
}
interface DecodedService {
    name: string;
    method: DecodedMethod[];
}
interface DecodedMethod {
    name: string;
    input_type: string;
    output_type: string;
    client_streaming: boolean;
    server_streaming: boolean;
}
/** Decodes a single FileDescriptorProto. */
declare function decodeFileDescriptorProto(buf: Uint8Array): DecodedFile;
declare function decodeFileDescriptorSet(buf: Uint8Array): DecodedFile[];

/**
 * Descriptor field access.
 *
 * proto-loader and the reflection path both surface descriptors as
 * protobufjs `toObject()` output, where key casing (camelCase vs snake_case)
 * and enum representation (numeric vs string) are not guaranteed across
 * versions. Every read goes through these helpers.
 *
 * Design rule: these helpers NEVER substitute a default for a shape they did
 * not understand. A missing container throws `DescriptorShapeError`; a missing
 * scalar throws too. Defaulting is what previously let an entire descriptor
 * source degrade to "every service has zero methods" without a single warning.
 *
 * The only tolerated absence is a genuinely optional descriptor field
 * (`type_name`, `json_name`, `oneof_index`), which is modelled as `undefined`.
 */
/** Raised when a descriptor object does not have the shape we require. */
declare class DescriptorShapeError extends Error {
    readonly expected: string;
    readonly observedKeys: string[];
    constructor(expected: string, observed: unknown, hint?: string);
}
declare const TYPE_NAMES: Record<number, string>;
declare const LABEL_NAMES: Record<number, string>;
/** Best-effort enum name for diagnostics only. Never feeds behaviour. */
declare function enumName(value: unknown, table: Record<number, string>): string | undefined;
interface FieldDescriptor {
    name: string;
    number: number;
    /** TYPE_* */
    type: string;
    /** LABEL_* */
    label: string;
    /** Fully-qualified with a leading dot, e.g. ".demo.common.Meta" */
    typeName?: string;
    jsonName?: string;
    oneofIndex?: number;
    /** True only for `optional` in proto3 (explicit presence). */
    proto3Optional: boolean;
}
declare function readFields(messageType: unknown): FieldDescriptor[];
declare function readOneofNames(messageType: unknown): string[];
declare function readNestedTypes(messageType: unknown): unknown[];
declare function isMapEntry(messageType: unknown): boolean;
declare function readEnumValueNames(enumType: unknown): string[];
interface MethodDescriptor {
    name: string;
    /** Fully-qualified with a leading dot. */
    inputType: string;
    outputType: string;
    clientStreaming: boolean;
    serverStreaming: boolean;
}
declare function readMethods(serviceType: unknown): MethodDescriptor[];

type GrpcJs = typeof _grpc_grpc_js;
type ProtoLoader = typeof _grpc_proto_loader;
interface LoadedGrpc {
    grpc: GrpcJs;
    protoLoader: ProtoLoader;
    /** Capabilities probed once at load time, so call sites never re-check. */
    capabilities: GrpcCapabilities;
}
interface GrpcCapabilities {
    /** proto-loader >= 0.7. Required by reflection. */
    descriptorSetFromBuffer: boolean;
    /** Version strings when readable, for diagnostics. */
    grpcVersion?: string;
    protoLoaderVersion?: string;
}
/**
 * The optional gRPC peer dependencies are missing.
 *
 * Distinguished from every other load failure because it is the only one the
 * user can fix with an install command; telling someone to install a package
 * they already have is worse than saying nothing.
 */
declare class GrpcDependencyMissingError extends Error {
    readonly missing: readonly string[];
    constructor(missing: readonly string[], cause?: unknown);
}
/**
 * The package is installed but unusable: it failed to evaluate, or its shape is
 * not what this library requires. Actionable in a completely different way from
 * a missing install, so it is a separate type.
 */
declare class GrpcDependencyBrokenError extends Error {
    readonly packageName: string;
    constructor(packageName: string, reason: string, cause?: unknown);
}
/**
 * Loads the optional gRPC peer dependencies on first use, so HTTP-only
 * consumers never pay for them and never need them installed.
 */
declare function loadGrpc(): Promise<LoadedGrpc>;
/** Non-throwing probe, for callers deciding whether to offer gRPC at all. */
declare function isGrpcAvailable(): Promise<boolean>;
/**
 * Asserts a capability, naming the version that provides it.
 *
 * Centralised here because the loader is the only place that knows what was
 * actually loaded; probing at each call site means each new call site can
 * forget to probe.
 */
declare function requireCapability(loaded: LoadedGrpc, capability: keyof GrpcCapabilities): void;

/** Reported alongside a result so a relaxed check is never silent. */
interface CredentialsBuildResult {
    credentials: _grpc_grpc_js.ChannelCredentials;
    /**
     * What was actually built, derived from the inputs rather than from intent:
     * "tls-system-roots" is also what you get from `tls: { skipHostnameVerification: true }`
     * with no rootCerts, which is a very different configuration than it looks.
     */
    mode: "insecure" | "tls-system-roots" | "tls-custom-roots" | "mtls";
    warnings: string[];
}
/**
 * Builds channel credentials, reporting what was actually built.
 *
 * The reported mode is derived from the inputs rather than from the caller's
 * intent, so a config that silently degrades to system roots (or to plaintext)
 * is visible in the result instead of being discovered at the first failed
 * handshake.
 */
declare function buildCredentialsChecked(source: GrpcCredentialsOptions, { grpc }: LoadedGrpc): CredentialsBuildResult;
/**
 * Convenience wrapper for call sites that have nowhere to put warnings.
 *
 * Prefer `buildCredentialsChecked` anywhere the warnings can reach the user;
 * dropping them is a deliberate loss, not a free simplification.
 */
declare function buildCredentials(source: GrpcCredentialsOptions, loaded: LoadedGrpc): _grpc_grpc_js.ChannelCredentials;
declare function buildCredentialsAsync(source: GrpcCredentialsOptions): Promise<_grpc_grpc_js.ChannelCredentials>;
declare function buildCredentialsCheckedAsync(source: GrpcCredentialsOptions): Promise<CredentialsBuildResult>;

export { type BuildTemplateOptions, type Catalog, type CollectProtoOptions, type CollectionHint, type CredentialsBuildResult, type DecodedEnum, type DecodedField, type DecodedFile, type DecodedMessage, type DecodedMethod, type DecodedService, type DescribeOptions, DescriptorDecodeError, type DescriptorSetResult, DescriptorShapeError, type DiscoveredMethod, type DiscoveredService, type DiscoveryResult, type EnumHint, type FieldDescriptor, type FullDescriptorSetResult, GrpcAdapter, type GrpcAdapterOptions, type GrpcCapabilities, type GrpcCredentialsOptions, GrpcDependencyBrokenError, GrpcDependencyMissingError, type GrpcDescriptorSource, type GrpcEndpoint, type GrpcEvent, type GrpcEventDirection, type GrpcMessageEvent, type GrpcMetadataEvent, type GrpcMetadataInput, type GrpcMetadataOutput, type GrpcMethodKind, type GrpcPlan, type GrpcProtoFileSource, type GrpcReflectionSource, type GrpcResult, type GrpcSendOptions, type GrpcStatus, type GrpcStatusEvent, type GrpcStatusOrigin, type GrpcTarget, type GrpcTlsOptions, type GrpcTruncatedReason, type IncludeDirsResult, LABEL_NAMES, LOADER_OPTIONS, type ListServicesResult, type LoadedGrpc, type MessageTemplate, type MethodDescriptor, type MethodDetail, type OneofHint, type PresenceHint, type ProtoScanResult, type ReflectionOp, type ReflectionOutcome, ReflectionProtocolError, type ReflectionSessionOptions, ReflectionUnavailableError, type ReflectionVersion, type ResolveMethodOptions, type ResolvedMethod, type SymbolEntry, type SymbolKind, TYPE_NAMES, buildCatalog, buildCredentials, buildCredentialsAsync, buildCredentialsChecked, buildCredentialsCheckedAsync, buildMessageTemplate, decodeFileDescriptorProto, decodeFileDescriptorSet, deriveIncludeDirsDetailed, describeFromCatalog, describeMethod, discover, discoverFromCatalog, enumName, fetchDescriptorSet, fetchFullDescriptorSet, grpcCall, isGrpcAvailable, isMapEntry, listServices, listServicesDetailed, loadGrpc, readEnumValueNames, readFields, readMethods, readNestedTypes, readOneofNames, requireCapability, resolveMethod, scanProtoFiles, serializeDescriptorSet };
