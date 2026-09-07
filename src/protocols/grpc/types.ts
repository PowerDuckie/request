/* ================================================================== *
 * Method kinds
 * ================================================================== */

/**
 * Derived from the descriptor, never accepted from the caller.
 *
 * Picking the wrong one is not a recoverable guess: it decides whether the
 * write side must be half-closed and whether inbound messages are expected at
 * all, so a mismatch produces a hang rather than an error.
 */
export type GrpcMethodKind =
  | "unary"
  | "server_streaming"
  | "client_streaming"
  | "bidi_streaming";

/* ================================================================== *
 * Transport security
 * ================================================================== */

export interface GrpcTlsOptions {
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

export interface GrpcCredentialsOptions {
  /** false/undefined = insecure; true = TLS with system roots; object = custom. */
  tls?: boolean | GrpcTlsOptions;
}

/* ================================================================== *
 * Descriptor source
 *
 * A discriminated union rather than a flat bag of optional fields: the two
 * sources share no options at all, and a type that permits both filled in at
 * once forces a runtime rule ("reflection wins") that users have to learn from
 * a warning instead of from the compiler.
 * ================================================================== */

export interface GrpcProtoFileSource {
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

export interface GrpcReflectionSource {
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
export type GrpcDescriptorSource = GrpcProtoFileSource | GrpcReflectionSource;

/* ================================================================== *
 * Metadata
 * ================================================================== */

/**
 * Metadata as written by a caller. Single values are allowed because writing
 * `{ "x-trace": "abc" }` is what people mean.
 */
export type GrpcMetadataInput = Record<string, string | string[]>;

/**
 * Metadata as observed on the wire. Always arrays: HTTP/2 headers may repeat,
 * and collapsing repeats would silently discard data. Binary (`-bin`) values
 * are base64-encoded so the result stays JSON-serialisable.
 */
export type GrpcMetadataOutput = Record<string, string[]>;

/* ================================================================== *
 * Endpoint and target
 * ================================================================== */

interface GrpcConnection extends GrpcCredentialsOptions {
  /** host:port, no scheme. */
  address: string;
  /** Sent on every call made through this endpoint, including reflection. */
  metadata?: GrpcMetadataInput;
  channelOptions?: Record<string, unknown>;
}

/** Everything needed to reach a server and read its schema, without a method. */
export type GrpcEndpoint = GrpcConnection & GrpcDescriptorSource;

/** An endpoint plus the one method to invoke. */
export type GrpcTarget = GrpcEndpoint & {
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

/* ================================================================== *
 * Sending
 * ================================================================== */

export interface GrpcSendOptions {
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

/* ================================================================== *
 * Events
 * ================================================================== */

/**
 * "status" is its own direction rather than a flavour of "meta".
 *
 * Response headers and the terminal status are different observations — one is
 * mid-call, the other ends it — and giving them the same discriminant means a
 * `switch (event.direction)` cannot tell them apart. The terminal status is the
 * single most important event in the log, so it is the last one that should be
 * indistinguishable from anything else.
 */
export type GrpcEventDirection = "outbound" | "inbound" | "meta" | "status";

interface GrpcEventBase {
  seq: number;
  /** epoch ms */
  at: number;
}

export interface GrpcMessageEvent extends GrpcEventBase {
  direction: "outbound" | "inbound";
  payload: unknown;
}

/** Initial metadata, i.e. response headers. */
export interface GrpcMetadataEvent extends GrpcEventBase {
  direction: "meta";
  metadata: GrpcMetadataOutput;
}

export interface GrpcStatusEvent extends GrpcEventBase {
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
export type GrpcEvent = GrpcMessageEvent | GrpcMetadataEvent | GrpcStatusEvent;

/* ================================================================== *
 * Status
 * ================================================================== */

export interface GrpcStatus {
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
export type GrpcStatusOrigin = "server" | "client" | "synthesized";

/* ================================================================== *
 * Result
 * ================================================================== */

/**
 * Why this library stopped a call that would otherwise have continued.
 *
 * That is the whole definition of `truncated`, and it is what keeps
 * target.deadlineMs off this list: a deadline is enforced by the peer, so its
 * DEADLINE_EXCEEDED is a real outcome rather than an interruption.
 */
export type GrpcTruncatedReason =
  | "max_messages"
  | "idle_timeout"
  | "max_session"
  | "aborted";

export interface GrpcResult {
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
