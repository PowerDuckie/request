export { B as BuildTemplateOptions, C as Catalog, E as CollectProtoOptions, F as CollectionHint, H as CredentialsBuildResult, I as DecodedEnum, J as DecodedField, K as DecodedFile, M as DecodedMessage, N as DecodedMethod, O as DecodedService, P as DescribeOptions, a as DescriptorDecodeError, Q as DescriptorSetResult, d as DiscoveredMethod, e as DiscoveredService, D as DiscoveryResult, S as EnumHint, T as FullDescriptorSetResult, G as GrpcAdapter, U as GrpcAdapterOptions, V as GrpcCapabilities, b as GrpcDependencyBrokenError, c as GrpcDependencyMissingError, W as GrpcPlan, X as IncludeDirsResult, L as LOADER_OPTIONS, Y as ListServicesResult, Z as LoadedGrpc, _ as MessageTemplate, $ as MethodDetail, a0 as OneofHint, a1 as PresenceHint, a2 as ProtoScanResult, a3 as ReflectionOp, a4 as ReflectionOutcome, R as ReflectionProtocolError, a5 as ReflectionSessionOptions, f as ReflectionUnavailableError, a6 as ReflectionVersion, a7 as ResolveMethodOptions, a8 as ResolvedMethod, a9 as SymbolEntry, aa as SymbolKind, g as buildCatalog, h as buildCredentials, i as buildCredentialsAsync, j as buildCredentialsChecked, k as buildCredentialsCheckedAsync, l as buildMessageTemplate, m as decodeFileDescriptorProto, n as decodeFileDescriptorSet, o as deriveIncludeDirsDetailed, ab as describeFromCatalog, ac as describeMethod, p as discover, ad as discoverFromCatalog, q as fetchDescriptorSet, r as fetchFullDescriptorSet, s as grpcCall, t as isGrpcAvailable, u as listServices, v as listServicesDetailed, w as loadGrpc, x as requireCapability, y as resolveMethod, z as scanProtoFiles, A as serializeDescriptorSet } from '../../credentials-rqEKODvf.js';
export { r as GrpcCredentialsOptions, s as GrpcDescriptorSource, d as GrpcEndpoint, u as GrpcEvent, v as GrpcEventDirection, y as GrpcMessageEvent, z as GrpcMetadataEvent, B as GrpcMetadataInput, F as GrpcMetadataOutput, H as GrpcMethodKind, I as GrpcProtoFileSource, K as GrpcReflectionSource, L as GrpcResult, N as GrpcSendOptions, Q as GrpcStatus, R as GrpcStatusEvent, T as GrpcStatusOrigin, G as GrpcTarget, U as GrpcTlsOptions, V as GrpcTruncatedReason } from '../../types-C9ifzKqk.js';
import '@grpc/grpc-js';
import '@grpc/proto-loader';

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

export { DescriptorShapeError, type FieldDescriptor, LABEL_NAMES, type MethodDescriptor, TYPE_NAMES, enumName, isMapEntry, readEnumValueNames, readFields, readMethods, readNestedTypes, readOneofNames };
