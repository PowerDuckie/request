export type GrpcMethodKind =
  | "unary"
  | "server_streaming"
  | "client_streaming"
  | "bidi_streaming";

export interface GrpcTlsOptions {
  rootCerts?: Buffer;
  privateKey?: Buffer;
  certChain?: Buffer;
  /**
   * Skips hostname verification only. The certificate chain is STILL verified.
   * Use for self-signed certs issued to a different name.
   */
  skipHostnameVerification?: boolean;
}

export interface GrpcCredentialsOptions {
  /** false/undefined = insecure; true = TLS with system roots; object = custom. */
  tls?: boolean | GrpcTlsOptions;
}

export interface GrpcProtoSource {
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
export interface GrpcEndpoint extends GrpcProtoSource, GrpcCredentialsOptions {
  /** host:port, no scheme. */
  address: string;
  metadata?: Record<string, string | string[]>;
  channelOptions?: Record<string, unknown>;
}

export interface GrpcTarget extends GrpcEndpoint {
  /** Fully-qualified service name, e.g. "demo.echo.Echo". */
  service: string;
  /** Method name as declared in proto, e.g. "Say". */
  method: string;
  /** Per-call deadline in ms. Maps to a gRPC deadline, not an abort. */
  deadlineMs?: number;
}

export interface GrpcSendOptions {
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

export type GrpcEventDirection = "outbound" | "inbound" | "meta";

export interface GrpcEvent {
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

export interface GrpcStatus {
  code: number;
  /** e.g. "OK", "DEADLINE_EXCEEDED" */
  codeName: string;
  details?: string;
}

export type GrpcTruncatedReason =
  | "max_messages"
  | "idle_timeout"
  | "max_session"
  | "aborted";

export interface GrpcResult {
  protocol: "grpc";
  kind: GrpcMethodKind;
  target: GrpcTarget;
  events: GrpcEvent[];
  messages: unknown[];

  /** Response headers, i.e. the initial metadata. Absent if the call never got that far. */
  initialMetadata?: Record<string, string[]>;

  status?: GrpcStatus;
  /** Provenance of `status`. Undefined only when `status` itself is undefined. */
  statusOrigin?: GrpcStatusOrigin;

  /** Response trailers. */
  trailers?: Record<string, string[]>;

  truncated: boolean;
  truncatedReason?: GrpcTruncatedReason;
  error?: string;
  warnings: string[];
  durationMs: number;
}
export type GrpcStatusOrigin = "server" | "client" | "synthesized";
