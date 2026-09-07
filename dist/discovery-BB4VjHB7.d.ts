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
    /**
     * File the symbol was declared in. Unnamed descriptors get a stable synthetic
     * label ("(unnamed #1)"), never a shared placeholder: duplicate-definition
     * diagnostics compare these labels, and a constant would make every pair of
     * duplicates look like the same declaration seen twice.
     */
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
    /**
     * File names carried by the descriptors that were decoded and indexed.
     *
     * Deliberately separate from `files`: under the proto source `files` is what
     * was found on disk. Note that the two are not always the same *kind* of
     * name — see crossCheckFiles.
     */
    descriptorFiles: string[];
    /**
     * Fully-qualified names of synthetic map-entry messages.
     *
     * They are deliberately absent from `symbols` — a user can never name one —
     * but anything resolving a field's `type_name` still has to tell "this is a
     * map entry" apart from "this type is missing".
     */
    mapEntries: Set<string>;
    /**
     * True when none of the decoded descriptors carried a file name.
     *
     * Diagnostic wording only. It is deliberately NOT a switch for any check:
     * treating "names exist" as "names are comparable to paths" is what produced
     * a confidently false coverage warning for two files whose symbols were all
     * present.
     */
    descriptorFilesUnnamed: boolean;
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

export { buildCatalog as A, type BuildTemplateOptions as B, type Catalog as C, type DiscoveryResult as D, type EnumHint as E, buildMessageTemplate as F, type GrpcTarget as G, describeFromCatalog as H, describeMethod as I, discoverFromCatalog as J, LOADER_OPTIONS as L, type MethodDetail as M, type OneofHint as O, type PresenceHint as P, type SymbolEntry as S, type GrpcEndpoint as a, type DiscoveredMethod as b, type DiscoveredService as c, discover as d, type GrpcResult as e, type DescribeOptions as f, type GrpcSendOptions as g, type GrpcMethodKind as h, type GrpcCredentialsOptions as i, type CollectionHint as j, type GrpcDescriptorSource as k, type GrpcEvent as l, type GrpcEventDirection as m, type GrpcMessageEvent as n, type GrpcMetadataEvent as o, type GrpcMetadataInput as p, type GrpcMetadataOutput as q, type GrpcProtoFileSource as r, type GrpcReflectionSource as s, type GrpcStatus as t, type GrpcStatusEvent as u, type GrpcStatusOrigin as v, type GrpcTlsOptions as w, type GrpcTruncatedReason as x, type MessageTemplate as y, type SymbolKind as z };
