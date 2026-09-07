import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type { PackageDefinition, ServiceDefinition } from "@grpc/proto-loader";

import { buildCatalog } from "./catalog.js";
import type { GrpcEndpoint } from "./types.js";

export type GrpcMethodKind =
  | "unary"
  | "server_streaming"
  | "client_streaming"
  | "bidi_streaming";

export type GrpcManualSessionState =
  | "idle"
  | "connecting"
  | "open"
  | "closing"
  | "closed"
  | "error";

export type GrpcDescriptorSourceKind = "proto" | "reflection";

export interface GrpcManualSessionEvent {
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

export interface GrpcManualSessionTarget {
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

export interface GrpcManualSession {
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

/**
 * loadPackageDefinition 返回的 GrpcObject 里，路径中间节点是命名空间对象，
 * 只有叶子才是带 .service 的客户端构造函数。
 */
type ServiceClientConstructor = (new (
  address: string,
  credentials: grpc.ChannelCredentials,
  options?: Record<string, unknown>,
) => grpc.Client & Record<string, any>) & {
  service: ServiceDefinition;
};

function createMetadata(input?: Record<string, string>): grpc.Metadata {
  const metadata = new grpc.Metadata();

  for (const [key, value] of Object.entries(input ?? {})) {
    metadata.set(key, value);
  }

  return metadata;
}

function getCredentials(tls: unknown): grpc.ChannelCredentials {
  if (!tls) {
    return grpc.credentials.createInsecure();
  }

  return grpc.credentials.createSsl();
}

function getDeadline(deadlineMs?: number): Date | undefined {
  if (!deadlineMs || deadlineMs <= 0) {
    return undefined;
  }

  return new Date(Date.now() + deadlineMs);
}

function hasProtoPaths(target: GrpcManualSessionTarget): boolean {
  return (
    Array.isArray(target.protoPaths) &&
    target.protoPaths.some((item) => typeof item === "string" && item.trim())
  );
}

function normalizeProtoPaths(target: GrpcManualSessionTarget): string[] {
  return (target.protoPaths ?? []).filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

/**
 * buildCatalog 对外把 packageDefinition 宽化成了 Record<string, unknown>，
 * 因为 discovery 只需要遍历它。运行时它就是 protoLoader.load() 的产物。
 * 这里先做形状校验再收窄，避免盲目断言把错误推迟到 new serviceCtor()。
 */
function asPackageDefinition(
  definition: Record<string, unknown> | undefined,
): PackageDefinition {
  if (!definition || typeof definition !== "object") {
    throw new Error(
      "The gRPC descriptor source did not return a usable package definition.",
    );
  }

  for (const [key, value] of Object.entries(definition)) {
    if (!value || typeof value !== "object") {
      throw new Error(
        `gRPC package definition entry "${key}" is not an object; ` +
          "the descriptor source returned an unexpected shape.",
      );
    }
  }

  return definition as unknown as PackageDefinition;
}

function resolveServiceConstructor(
  root: grpc.GrpcObject,
  dottedPath: string,
): ServiceClientConstructor | undefined {
  if (typeof dottedPath !== "string" || !dottedPath.trim()) {
    return undefined;
  }

  const found = dottedPath
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      root,
    );

  if (typeof found !== "function") {
    return undefined;
  }

  const candidate = found as Partial<ServiceClientConstructor>;

  if (!candidate.service || typeof candidate.service !== "object") {
    return undefined;
  }

  return found as ServiceClientConstructor;
}

function resolveMethodKind(definition: {
  requestStream?: boolean;
  responseStream?: boolean;
}): GrpcMethodKind {
  if (definition.requestStream && definition.responseStream) {
    return "bidi_streaming";
  }

  if (definition.requestStream && !definition.responseStream) {
    return "client_streaming";
  }

  if (!definition.requestStream && definition.responseStream) {
    return "server_streaming";
  }

  return "unary";
}

function resolveMethodOriginalName(
  serviceCtor: ServiceClientConstructor,
  requestedMethod: string,
): string {
  if (typeof requestedMethod !== "string" || !requestedMethod.trim()) {
    throw new Error("Invalid gRPC method name");
  }

  const definitions = serviceCtor.service ?? {};

  if (definitions[requestedMethod]) {
    return requestedMethod;
  }

  const wanted = requestedMethod.toLowerCase();

  for (const [key, value] of Object.entries(definitions)) {
    const rpcPath =
      typeof (value as any)?.path === "string"
        ? ((value as any).path as string)
        : undefined;

    if (
      key.toLowerCase() === wanted ||
      rpcPath?.split("/").pop()?.toLowerCase() === wanted
    ) {
      return key;
    }
  }

  const available = Object.keys(definitions).sort();

  throw new Error(
    available.length
      ? `Unable to resolve gRPC method "${requestedMethod}". Available: ${available.join(", ")}`
      : `Unable to resolve gRPC method "${requestedMethod}"`,
  );
}

interface LoadedService {
  client: grpc.Client & Record<string, any>;
  methodName: string;
  kind: GrpcMethodKind;
  source: GrpcDescriptorSourceKind;
}

function buildClient(
  serviceCtor: ServiceClientConstructor,
  target: GrpcManualSessionTarget,
  source: GrpcDescriptorSourceKind,
): LoadedService {
  const methodName = resolveMethodOriginalName(serviceCtor, target.method);
  const methodDefinition = serviceCtor.service[methodName];

  if (!methodDefinition) {
    throw new Error(
      `Unable to resolve gRPC method "${target.service}/${target.method}"`,
    );
  }

  const client = new serviceCtor(
    target.address,
    getCredentials(target.tls),
    target.channelOptions ?? {},
  );

  return {
    client,
    methodName,
    kind: resolveMethodKind(methodDefinition),
    source,
  };
}

async function loadServiceFromProto(
  target: GrpcManualSessionTarget,
): Promise<LoadedService> {
  const protoPaths = normalizeProtoPaths(target);

  if (!protoPaths.length) {
    throw new Error(
      "protoPaths is required when loading a gRPC service from proto files.",
    );
  }

  const packageDefinition = await protoLoader.load(protoPaths, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    ...(target.loaderOptions ?? {}),
  });

  const root = grpc.loadPackageDefinition(packageDefinition);
  const serviceCtor = resolveServiceConstructor(root, target.service);

  if (!serviceCtor) {
    throw new Error(
      `Unable to resolve gRPC service "${target.service}" from the provided proto files. ` +
        'Make sure the name is fully qualified, e.g. "package.ServiceName".',
    );
  }

  return buildClient(serviceCtor, target, "proto");
}

/**
 * 原实现只支持 protoPaths，却在错误信息里声称支持 reflection。
 * 这里补上真正的 reflection 分支：先用 buildCatalog 取回描述符，
 * 再用同一份 packageDefinition 构造运行时客户端。
 */
async function loadServiceFromReflection(
  target: GrpcManualSessionTarget,
): Promise<LoadedService> {
  const endpoint = {
    address: target.address,
    reflection: true,
    metadata: target.metadata,
    channelOptions: target.channelOptions,
    tls: target.tls,
    reflectionTimeoutMs: target.reflectionTimeoutMs,
    reflectionVersion: target.reflectionVersion,
    reflectionHost: target.reflectionHost,
    loaderOptions: target.loaderOptions,
  } as unknown as GrpcEndpoint;

  const { catalog, packageDefinition } = await buildCatalog(endpoint);

  const root = grpc.loadPackageDefinition(
    asPackageDefinition(packageDefinition as Record<string, unknown>),
  );

  const serviceCtor = resolveServiceConstructor(root, target.service);

  if (!serviceCtor) {
    const known = [
      ...new Set([
        ...((catalog as any)?.services ?? []),
        ...((catalog as any)?.invocableServices ?? []),
      ]),
    ]
      .filter((item): item is string => typeof item === "string")
      .sort();

    throw new Error(
      known.length
        ? `Unable to resolve gRPC service "${target.service}" via reflection. Available: ${known.join(", ")}`
        : `Unable to resolve gRPC service "${target.service}" via reflection; the server exposed no services.`,
    );
  }

  return buildClient(serviceCtor, target, "reflection");
}

async function loadService(
  target: GrpcManualSessionTarget,
): Promise<LoadedService> {
  const usesProto = hasProtoPaths(target);
  const usesReflection = target.reflection === true;

  if (!usesProto && !usesReflection) {
    throw new Error(
      "a gRPC endpoint needs a descriptor source: either set reflection: true, or pass protoPaths: string[] pointing at your .proto files or directories. Neither was provided.",
    );
  }

  if (usesProto) {
    return loadServiceFromProto(target);
  }

  return loadServiceFromReflection(target);
}

export async function createGrpcManualSession(
  target: GrpcManualSessionTarget,
): Promise<GrpcManualSession> {
  const events: GrpcManualSessionEvent[] = [];
  const warnings: unknown[] = [];
  const maxEvents = 1000;

  let state: GrpcManualSessionState = "idle";
  let sentCount = 0;

  let closeResolve: () => void = () => {};

  const closePromise = new Promise<void>((resolve) => {
    closeResolve = resolve;
  });

  const { client, methodName, kind, source } = await loadService(target);
  const metadata = createMetadata(target.metadata);
  const deadline = getDeadline(target.deadlineMs);

  let activeCall: any = null;

  function record(event: GrpcManualSessionEvent) {
    events.push(event);
    if (maxEvents > 0 && events.length > maxEvents) {
      events.splice(0, events.length - maxEvents);
    }
  }

  function markClosed() {
    if (state !== "closed") {
      state = "closed";
      closeResolve();
    }
  }

  function attachSharedListeners(call: any) {
    call.on("metadata", (incomingMetadata: grpc.Metadata) => {
      record({
        direction: "meta",
        event: "metadata",
        metadata: incomingMetadata.getMap(),
        at: Date.now(),
      });
    });

    call.on("status", (status: grpc.StatusObject) => {
      record({
        direction: "status",
        event: "status",
        code: status.code,
        statusName: grpc.status[status.code],
        details: status.details,
        metadata: status.metadata?.getMap?.() ?? undefined,
        at: Date.now(),
      });

      markClosed();
    });

    call.on("error", (error: any) => {
      record({
        direction: "status",
        event: "error",
        code: error?.code,
        statusName:
          typeof error?.code === "number" ? grpc.status[error.code] : undefined,
        details: error?.details ?? error?.message,
        metadata: error?.metadata?.getMap?.() ?? undefined,
        error: error?.message ?? String(error),
        at: Date.now(),
      });

      state = "error";
      closeResolve();
    });

    call.on("end", () => {
      record({
        direction: "meta",
        event: "end",
        at: Date.now(),
      });

      if (kind === "server_streaming" || kind === "bidi_streaming") {
        markClosed();
      }
    });
  }

  function createCallForStreamingRequestKinds() {
    if (activeCall) {
      return activeCall;
    }

    const options: Record<string, unknown> = {};
    if (deadline) {
      options.deadline = deadline;
    }

    if (kind === "client_streaming") {
      activeCall = client[methodName](
        metadata,
        options,
        (error: any, response: unknown) => {
          if (error) {
            state = "error";

            record({
              direction: "status",
              event: "error",
              code: error?.code,
              statusName:
                typeof error?.code === "number"
                  ? grpc.status[error.code]
                  : undefined,
              details: error?.details ?? error?.message,
              metadata: error?.metadata?.getMap?.() ?? undefined,
              error: error?.message ?? String(error),
              at: Date.now(),
            });

            return;
          }

          record({
            direction: "inbound",
            event: "data",
            payload: response,
            at: Date.now(),
          });
        },
      );

      attachSharedListeners(activeCall);
      return activeCall;
    }

    if (kind === "bidi_streaming") {
      activeCall = client[methodName](metadata, options);
      attachSharedListeners(activeCall);

      activeCall.on("data", (response: unknown) => {
        record({
          direction: "inbound",
          event: "data",
          payload: response,
          at: Date.now(),
        });
      });

      return activeCall;
    }

    return null;
  }

  return {
    get state() {
      return state;
    },

    get kind() {
      return kind;
    },

    get source() {
      return source;
    },

    get events() {
      return events;
    },

    get warnings() {
      return warnings;
    },

    async open() {
      if (state !== "idle" && state !== "closed") {
        throw new Error(`gRPC session cannot open from state "${state}"`);
      }

      state = "connecting";

      if (kind === "client_streaming" || kind === "bidi_streaming") {
        createCallForStreamingRequestKinds();
      }

      state = "open";

      record({
        direction: "meta",
        event: "open",
        payload: {
          address: target.address,
          service: target.service,
          method: methodName,
          requestedMethod: target.method,
          kind,
          descriptorSource: source,
        },
        at: Date.now(),
      });
    },

    async send(message: unknown) {
      if (state !== "open") {
        throw new Error("gRPC session is not open");
      }

      record({
        direction: "outbound",
        event: "data",
        payload: message,
        at: Date.now(),
      });

      const options: Record<string, unknown> = {};
      if (deadline) {
        options.deadline = deadline;
      }

      if (kind === "unary") {
        if (sentCount > 0) {
          throw new Error("Unary gRPC call only supports one send()");
        }

        sentCount += 1;

        await new Promise<void>((resolve, reject) => {
          const call = client[methodName](
            message,
            metadata,
            options,
            (error: any, response: unknown) => {
              if (error) {
                state = "error";

                record({
                  direction: "status",
                  event: "error",
                  code: error?.code,
                  statusName:
                    typeof error?.code === "number"
                      ? grpc.status[error.code]
                      : undefined,
                  details: error?.details ?? error?.message,
                  metadata: error?.metadata?.getMap?.() ?? undefined,
                  error: error?.message ?? String(error),
                  at: Date.now(),
                });

                reject(error);
                return;
              }

              record({
                direction: "inbound",
                event: "data",
                payload: response,
                at: Date.now(),
              });

              resolve();
            },
          );

          activeCall = call;
          attachSharedListeners(call);
        });

        return;
      }

      if (kind === "server_streaming") {
        if (sentCount > 0) {
          throw new Error(
            "Server-streaming gRPC call only supports one send()",
          );
        }

        sentCount += 1;

        const call = client[methodName](message, metadata, options);
        activeCall = call;
        attachSharedListeners(call);

        call.on("data", (response: unknown) => {
          record({
            direction: "inbound",
            event: "data",
            payload: response,
            at: Date.now(),
          });
        });

        return;
      }

      if (kind === "client_streaming" || kind === "bidi_streaming") {
        const call = createCallForStreamingRequestKinds();

        if (!call) {
          throw new Error("Streaming gRPC call was not initialized");
        }

        await new Promise<void>((resolve, reject) => {
          call.write(message, (error: any) => {
            if (error) {
              reject(error);
              return;
            }

            sentCount += 1;
            resolve();
          });
        });

        return;
      }

      throw new Error(`Unsupported gRPC method kind: ${kind}`);
    },

    async close() {
      if (state === "closed") {
        return;
      }

      if (state !== "open" && state !== "error" && state !== "closing") {
        markClosed();
        return;
      }

      state = "closing";

      record({
        direction: "meta",
        event: "close",
        at: Date.now(),
      });

      if (kind === "client_streaming" || kind === "bidi_streaming") {
        if (activeCall && typeof activeCall.end === "function") {
          activeCall.end();
        } else {
          markClosed();
        }

        return;
      }

      if (activeCall && typeof activeCall.cancel === "function") {
        activeCall.cancel();
      } else {
        markClosed();
      }
    },

    async waitForClose() {
      await closePromise;
    },
  };
}

export const grpcManualSession = createGrpcManualSession;
