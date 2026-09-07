export { GrpcAdapter } from "./adapter.js";
export type { GrpcPlan } from "./adapter.js";

export { grpcCall } from "./call.js";
export { resolveMethod } from "./descriptor.js";
export type { ResolvedMethod } from "./descriptor.js";

export { discover, describeMethod, describeFromCatalog } from "./discovery.js";
export type {
  DiscoveredMethod,
  DiscoveredService,
  DiscoveryResult,
  MethodDetail,
} from "./discovery.js";

export { buildMessageTemplate } from "./template.js";
export type {
  BuildTemplateOptions,
  CollectionHint,
  EnumHint,
  MessageTemplate,
  OneofHint,
  PresenceHint,
} from "./template.js";

export { buildCatalog, LOADER_OPTIONS } from "./catalog.js";
export type { Catalog, SymbolEntry, SymbolKind } from "./catalog.js";

export { collectProtoFiles, deriveIncludeDirs } from "./proto-dir.js";
export type { CollectProtoOptions } from "./proto-dir.js";

export {
  fetchDescriptorSet,
  fetchFullDescriptorSet,
  listServices,
  serializeDescriptorSet,
} from "./reflection.js";
export type { ReflectionSessionOptions } from "./reflection.js";

export { buildCredentials, buildCredentialsAsync } from "./credentials.js";

export type {
  GrpcCredentialsOptions,
  GrpcEndpoint,
  GrpcEvent,
  GrpcEventDirection,
  GrpcMethodKind,
  GrpcProtoSource,
  GrpcResult,
  GrpcSendOptions,
  GrpcStatus,
  GrpcTarget,
  GrpcTlsOptions,
  GrpcTruncatedReason,
} from "./types.js";
