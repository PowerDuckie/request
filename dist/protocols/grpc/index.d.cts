import { a as GrpcEndpoint, C as Catalog, e as GrpcResult, D as DiscoveryResult, f as DescribeOptions, M as MethodDetail, G as GrpcTarget, g as GrpcSendOptions, h as GrpcMethodKind, i as GrpcCredentialsOptions } from '../../discovery-BB4VjHB7.cjs';
export { B as BuildTemplateOptions, j as CollectionHint, b as DiscoveredMethod, c as DiscoveredService, E as EnumHint, k as GrpcDescriptorSource, l as GrpcEvent, m as GrpcEventDirection, n as GrpcMessageEvent, o as GrpcMetadataEvent, p as GrpcMetadataInput, q as GrpcMetadataOutput, r as GrpcProtoFileSource, s as GrpcReflectionSource, t as GrpcStatus, u as GrpcStatusEvent, v as GrpcStatusOrigin, w as GrpcTlsOptions, x as GrpcTruncatedReason, L as LOADER_OPTIONS, y as MessageTemplate, O as OneofHint, P as PresenceHint, S as SymbolEntry, z as SymbolKind, A as buildCatalog, F as buildMessageTemplate, H as describeFromCatalog, I as describeMethod, d as discover, J as discoverFromCatalog } from '../../discovery-BB4VjHB7.cjs';
import * as _grpc_grpc_js from '@grpc/grpc-js';
import * as _grpc_proto_loader from '@grpc/proto-loader';

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
    /**
     * Maximum number of cached catalogs. Default 32.
     *
     * A descriptor set is large, and a long-lived process pointed at many
     * endpoints would otherwise grow this map without bound — a cache with a
     * staleness budget but no size budget is still a leak.
     */
    maxCachedCatalogs?: number;
}
declare class GrpcAdapter {
    readonly protocol: "grpc";
    private readonly catalogTtlMs;
    private readonly maxCachedCatalogs;
    /** Insertion-ordered, so the oldest key is the first one Map yields. */
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
    /**
     * Guards the endpoint-only entry points.
     *
     * These are public and are reached directly by discovery UIs, so they cannot
     * rely on assertSupported having run — and they must not require a service or
     * method, which is the whole point of discovery.
     */
    private assertEndpoint;
    /**
     * Builds or reuses the catalog for an endpoint.
     *
     * In-flight de-duplication applies even when caching is off. With
     * catalogTtlMs: 0 the intent is "never reuse a stale catalog", not "dial the
     * server once per concurrent caller"; the second reading would make disabling
     * the cache a way to multiply reflection round-trips.
     */
    catalogFor(endpoint: GrpcEndpoint): Promise<CachedCatalog>;
    /** Drops the oldest entries once the cache exceeds its size budget. */
    private evict;
    /**
     * Drops cached descriptors, for when the server or the proto tree changed.
     *
     * In-flight builds are dropped too. A build already running was started
     * against the state the caller is now declaring stale, so handing its result
     * to the next caller would serve exactly what invalidate() was called to
     * avoid. Callers already awaiting that promise still receive it — the
     * alternative is rejecting a request that has done nothing wrong.
     */
    invalidate(endpoint?: GrpcEndpoint): void;
    /** Diagnostics about the descriptor source, reported once per endpoint. */
    sourceNotes(endpoint: GrpcEndpoint): Promise<string[]>;
    /**
     * Produces an export bundle for one method.
     *
     * Unlike the HTTP adapter this performs I/O — reading the proto tree, or
     * dialling the server when reflection is the source — because a gRPC method's
     * streaming kind and message shapes exist nowhere else.
     */
    plan(target: unknown): Promise<GrpcPlan>;
    /**
     * Invokes the method, reusing the cached descriptor source.
     *
     * Passing the catalog through is not an optimisation. Left to build its own,
     * grpcCall would re-read the proto tree or — under reflection — dial again,
     * so plan() and run() could observe two different server states, and the
     * runtime/descriptor cross-check inside resolveMethod would be comparing two
     * moments instead of two views.
     */
    run(target: unknown, options?: unknown): Promise<GrpcResult>;
    /** Not part of ProtocolAdapter; exposed for discovery UIs. */
    discover(endpoint: GrpcEndpoint): Promise<DiscoveryResult>;
    describeMethod(endpoint: GrpcEndpoint, service: string, method: string, options?: DescribeOptions): Promise<MethodDetail>;
}

/**
 * A descriptor source already built by the caller.
 *
 * Passing one is not merely an optimisation. Under reflection every
 * `buildCatalog` is a fresh dial, so resolving the method again here would
 * compare the runtime and descriptor views of two different server states —
 * exactly the disagreement `resolveMethod` refuses to guess through. A host
 * that already holds a catalog (GrpcAdapter does) must hand it over.
 */
interface GrpcCallContext {
    catalog: Catalog;
    packageDefinition: Record<string, unknown>;
    /**
     * Whether catalog-wide diagnostics belong in this call's `warnings`.
     *
     * Default false. A catalog note describes the descriptor source — "3 .proto
     * files were merged", "these type references do not resolve" — and is a
     * property of the endpoint, not of one invocation. Repeating it on every call
     * buries the notes that are about the call, which is what turned the warning
     * list into scrollback. Surface them once, from discover()/describeMethod().
     */
    includeSourceNotes?: boolean;
}
/**
 * Invokes one gRPC method. All four streaming kinds converge on a single event
 * log and a single set of termination conditions.
 *
 * Transport-level failures are reported in the result rather than thrown; only
 * option validation and descriptor resolution — both of which happen before any
 * bytes move — throw.
 *
 * Without a `context`, this builds a descriptor source on every call, which
 * means reading the proto tree or dialling reflection each time. Calling it in
 * a loop that way is wasteful and, under reflection, unsound; go through
 * GrpcAdapter, or pass the catalog yourself.
 */
declare function grpcCall(target: GrpcTarget, options?: GrpcSendOptions, context?: GrpcCallContext): Promise<GrpcResult>;

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
    /**
     * Fully-qualified request/response message names, when the descriptor had
     * them. "Fully-qualified" is a promise to the caller: these are written into
     * exported collections and quoted in client-side error messages, so a
     * relative name here is a wrong name, not a shorter one.
     */
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
    metadata?: Record<string, string | string[] | Buffer | Buffer[]>;
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
    /**
     * Filenames included, in the same order as the descriptors inside
     * `descriptorSet`.
     *
     * The correspondence is positional and load-bearing: `files[i]` names the
     * i-th FileDescriptorProto in the set. Sorting this list independently — which
     * it used to be — silently broke that pairing for anyone who relied on it.
     */
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
    /** Versions read from each package.json, when readable. Diagnostics only. */
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
 *
 * Unknown keys throw rather than pass. The previous early return made this a
 * no-op for anything but one capability, so adding a capability and forgetting
 * to handle it here would silently disable its check.
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

export { Catalog, type CollectProtoOptions, type CredentialsBuildResult, type DecodedEnum, type DecodedField, type DecodedFile, type DecodedMessage, type DecodedMethod, type DecodedService, DescribeOptions, DescriptorDecodeError, type DescriptorSetResult, DescriptorShapeError, DiscoveryResult, type FieldDescriptor, type FullDescriptorSetResult, GrpcAdapter, type GrpcAdapterOptions, type GrpcCapabilities, GrpcCredentialsOptions, GrpcDependencyBrokenError, GrpcDependencyMissingError, GrpcEndpoint, GrpcMethodKind, type GrpcPlan, GrpcResult, GrpcSendOptions, GrpcTarget, type IncludeDirsResult, LABEL_NAMES, type ListServicesResult, type LoadedGrpc, type MethodDescriptor, MethodDetail, type ProtoScanResult, type ReflectionOp, type ReflectionOutcome, ReflectionProtocolError, type ReflectionSessionOptions, ReflectionUnavailableError, type ReflectionVersion, type ResolveMethodOptions, type ResolvedMethod, TYPE_NAMES, buildCredentials, buildCredentialsAsync, buildCredentialsChecked, buildCredentialsCheckedAsync, decodeFileDescriptorProto, decodeFileDescriptorSet, deriveIncludeDirsDetailed, enumName, fetchDescriptorSet, fetchFullDescriptorSet, grpcCall, isGrpcAvailable, isMapEntry, listServices, listServicesDetailed, loadGrpc, readEnumValueNames, readFields, readMethods, readNestedTypes, readOneofNames, requireCapability, resolveMethod, scanProtoFiles, serializeDescriptorSet };
