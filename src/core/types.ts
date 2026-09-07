export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type ProtocolName =
  | "http"
  | "sse"
  | "websocket"
  | "grpc"
  | "graphql"
  | "mcp";

/**
 * An OpenAPI 3.2 document. Kept loose on purpose: the toolkit tolerates
 * partial and vendor-extended documents rather than validating them upfront.
 */
export type OpenApiDocument = Record<string, any>;

/** Identifies a single operation inside an OpenAPI document. */
export interface OperationTarget {
  /** Templated path, e.g. '/users/{id}'. Requires `method`. */
  path?: string;
  /** HTTP method, case-insensitive. Requires `path`. */
  method?: string;
  /** Alternative lookup key; takes precedence over path + method. */
  operationId?: string;
}

/** User-supplied values injected into the generated request. */
export interface RequestValues {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  header?: Record<string, unknown>;
  cookie?: Record<string, unknown>;
  /** OpenAPI 3.2 `querystring` parameter location: a raw, pre-encoded query string. */
  querystring?: string;
  body?: unknown;
  /** Force a specific request media type when the operation declares several. */
  contentType?: string;
}

export interface AuthConfig {
  type: "bearer" | "basic" | "apikey" | "none";
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  in?: "header" | "query";
}

/* ------------------------------------------------------------------ */
/* Scripting                                                           */
/* ------------------------------------------------------------------ */

export interface ScriptSource {
  /** Script body, either a single string or an array of lines. */
  exec: string | string[];
  /** Optional identifier surfaced in script results. */
  id?: string;
}

export interface ScriptConfig {
  collectionPreRequest?: ScriptSource | ScriptSource[];
  collectionTest?: ScriptSource | ScriptSource[];
  preRequest?: ScriptSource | ScriptSource[];
  test?: ScriptSource | ScriptSource[];
  /**
   * Read `x-postman-scripts` from the spec.
   *
   * @default true
   *
   * JavaScript embedded in a third-party document executes in the sandbox when
   * this is enabled, which the caller may not expect. Loading such a document
   * pushes a warning onto `BuiltCollection.warnings`. The default becomes
   * `false` in 0.2.0; set it explicitly to pin current behaviour.
   */
  fromSpecExtensions?: boolean;
  /** Append the built-in helper exposing the last response to later requests. */
  captureLastResponse?: boolean; // added
}

export interface AssertionResult {
  name: string;
  passed: boolean;
  skipped: boolean;
  index: number;
  error?: { name?: string; message: string; stack?: string };
}

export interface ConsoleLog {
  level: "log" | "info" | "warn" | "error" | "debug";
  messages: unknown[];
  at: number;
}

export interface ScriptOutcome {
  target: "prerequest" | "test";
  scriptId?: string;
  error?: { name?: string; message: string };
  /** Full variable scope snapshot after the script ran (not a diff). */
  environment?: Record<string, string>;
  globals?: Record<string, string>;
  /**
   * Values produced by pm.execution.setNextRequest / skipRequest, etc.
   * Widened to `unknown`: the runtime also returns bare strings here.
   */
  return?: unknown; // changed
}

export interface ScriptReport {
  prerequest: ScriptOutcome[];
  test: ScriptOutcome[];
  assertions: AssertionResult[];
  console: ConsoleLog[];
  /** False when at least one non-skipped assertion failed. */
  passed: boolean;
  /** True when the item was skipped via pm.execution.skipRequest(). */
  skipped: boolean;
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */

export interface StreamEvent {
  /** SSE `id` field, or a synthetic sequence number for WebSocket frames. */
  id?: string;
  /** SSE `event` field, or the WebSocket frame kind ('text' | 'binary' | 'ping'). */
  event?: string;
  data: string;
  /** Populated when `data` parses as JSON. */
  parsed?: Json;
  retry?: number;
  receivedAt: number;
  /** Message direction. WebSocket only; SSE events are always inbound. */
  direction?: "in" | "out";
}

/**
 * Why sampling ended before the peer closed the connection.
 * Absent when the stream or response completed on its own.
 */
export type StopReason = // added
  | "maxEvents"
  | "maxStreamMs"
  | "maxResponseSize"
  | "maxSessionMs"
  | "idleTimeout"
  | "aborted"
  | "hardTimeout";

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export interface ReplayRecord {
  url: string;
  method: string;
  status: number;
  /** Origin reported by the runtime, e.g. 'authorizer' or 'redirect'. */
  reason?: string;
}

export interface ExecResult {
  protocol: ProtocolName;
  request: {
    method: string;
    url: string;
    /** Header names keep the casing reported by the runtime. */
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    statusText: string;
    /**
     * Header names keep the casing reported by the server. HTTP header names
     * are case-insensitive, so lower-case before comparing.
     */
    headers: Record<string, string>;
    contentType?: string;
    /** Parsed body for non-streaming responses. */
    body?: unknown;
    text?: string;
    /** Collected events for streaming protocols. Never longer than `maxEvents`. */
    events?: StreamEvent[];
    timings: {
      startedAt: number;
      endedAt: number;
      /** Total wall-clock time: `endedAt - startedAt`. */
      durationMs: number;
      /** Time to first byte, relative to `startedAt`. */
      firstByteMs?: number;
      /**
       * Network exchange time as reported by postman-runtime, excluding script
       * execution and sampling overhead. Far below `durationMs` on a sampled
       * stream, which is why it is a separate field rather than `durationMs`.
       */
      networkDurationMs?: number; // added
    };
    /** Body bytes received. Header bytes are not counted. */
    sizeBytes: number;
    /**
     * True when sampling stopped before the stream ended naturally.
     * Absent (undefined) when the stream completed on its own.
     */
    truncated?: boolean;
    /** Set alongside `truncated` to identify which limit was reached. */
    stopReason?: StopReason; // added
    /**
     * Events discarded by the parser's own size caps, as opposed to those
     * withheld by `maxEvents`. A non-zero value means payload data was lost.
     */
    droppedEvents?: number; // added
  };
  scripts?: ScriptReport;
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
  replays?: ReplayRecord[];
  error?: { message: string; code?: string; name?: string; stack?: string }; // added stack
}

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

/**
 * Raw postman-runtime options. Every documented field is passed straight through
 * to `runner.run()`. Anything set here wins over the library defaults.
 */
export interface RuntimeRunOptions {
  data?: Array<Record<string, unknown>>;
  timeout?: { request?: number; script?: number; global?: number };
  iterationCount?: number;
  stopOnError?: boolean;
  abortOnError?: boolean;
  stopOnFailure?: boolean;
  abortOnFailure?: boolean;
  environment?: any;
  globals?: any;
  localVariables?: any;
  secretResolver?: (
    ctx: { secrets: Array<{ key: string; value?: string }>; url: string },
    callback: (
      error: Error | null,
      result?: Array<{
        resolvedValue?: string;
        error?: unknown;
        allowedInScript?: boolean;
      }>,
    ) => void,
  ) => void;
  entrypoint?: {
    execute?: string;
    lookupStrategy?: "idOrName" | "path";
    path?: string[];
  };
  delay?: { item?: number; iteration?: number };
  fileResolver?: unknown;
  requester?: RequesterOptions;
  script?: {
    serializeLogs?: boolean;
    requestResolver?: (
      requestId: string,
      callback: (error: Error | null, collection?: any) => void,
    ) => void;
    packageResolver?: (
      ctx: { packages: any },
      callback: (
        error: Error | null,
        packages?: Record<string, { data?: string; error?: string }>,
      ) => void,
    ) => void;
  };
  proxies?: any;
  systemProxy?: (
    url: string,
    callback: (error: Error | null, config?: any) => void,
  ) => void;
  ignoreProxyEnvironmentVariables?: boolean;
  certificates?: any;
  systemCertificate?: () => void;
  [key: string]: unknown;
}

export interface RequesterOptions {
  cookieJar?: any;
  disableCookies?: boolean;
  followRedirects?: boolean;
  followOriginalHttpMethod?: boolean;
  maxRedirects?: number;
  /**
   * Byte ceiling for the response body. This is a hard cut, not a hint:
   * a streaming call with a tiny value yields an empty event list. A value of
   * `0` is rejected with BAD_RUN_OPTIONS rather than treated as "no bytes".
   * Leave undefined for streaming operations.
   */
  maxResponseSize?: number;
  maxHeaderSize?: number;
  protocolVersion?: "http1" | "http2" | "auto";
  useWhatWGUrlParser?: boolean;
  removeRefererHeaderOnRedirect?: boolean;
  strictSSL?: boolean;
  insecureHTTPParser?: boolean;
  timings?: boolean;
  verbose?: boolean;
  implicitCacheControl?: boolean;
  implicitTraceHeader?: boolean;
  systemHeaders?: Record<string, string>;
  extendedRootCA?: string;
  network?: {
    hostLookup?: { type: string; hostIpMap?: Record<string, string> };
    restrictedAddresses?: Record<string, boolean>;
  };
  /**
   * Supplying agents disables the library's socket tracking, because tracking
   * requires owning `createConnection`. Stream cancellation then falls back to
   * `run.abort()` alone, which cannot interrupt an in-flight response body.
   */
  agents?: {
    http?:
      | { agentClass?: unknown; agentOptions?: Record<string, unknown> }
      | unknown;
    https?:
      | { agentClass?: unknown; agentOptions?: Record<string, unknown> }
      | unknown;
  };
  authorizer?: {
    refreshOAuth2Token?: (
      id: string,
      callback: (error: Error | null, token?: string) => void,
    ) => void;
  };
  maxInvokableNestedRequests?: number;
  sslKeyLogFile?: string;
  [key: string]: unknown;
}

/** WebSocket-specific execution options. */
export interface WebSocketOptions {
  /** Absolute ws:// or wss:// URL. Overrides anything derived from the spec. */
  url?: string;
  subprotocols?: string[];
  headers?: Record<string, string>;
  /** Messages sent immediately after the connection opens. */
  send?: Array<string | Record<string, unknown> | Uint8Array>;
  /** Milliseconds to wait between consecutive outbound messages. */
  sendDelayMs?: number;
  /** Stop after this many inbound messages. */
  maxMessages?: number;
  /** Hard cap on total session duration. */
  maxSessionMs?: number;
  /** Close once no message arrives within this window. */
  idleTimeoutMs?: number;
  /** Application-level ping payload sent on an interval. */
  keepAlive?: { intervalMs: number; payload?: string };
  /** Close code sent when the client terminates the session. */
  closeCode?: number;
  closeReason?: string;
  /**
   * Milliseconds to wait for the peer's close frame after sending ours before
   * destroying the socket. A peer that never completes the closing handshake
   * would otherwise keep the session open indefinitely.
   */
  closeTimeoutMs?: number; // added
  /** Extra options forwarded verbatim to the `ws` client constructor. */
  clientOptions?: Record<string, unknown>;
  /** Reject self-signed certificates. Defaults to true. */
  rejectUnauthorized?: boolean;
  /** Cap on retained payload size per frame, in bytes. */
  maxPayloadBytes?: number;
}

/** GraphQL-specific execution options. */
export interface GraphQLOptions {
  /** Absolute HTTP(S) URL of the GraphQL endpoint. Overrides the resolved server URL. */
  endpoint?: string;
  /** Query or mutation document. Overrides whatever `x-graphql.query` declares. */
  query?: string;
  /** Name of the operation to run, required when `query` declares more than one. */
  operationName?: string;
  /** GraphQL variables. Merged over any sampled from `x-graphql.variablesSchema`. */
  variables?: Record<string, unknown>;
  /** Extra headers, merged over `values.header` and auth. */
  headers?: Record<string, string>;
  /**
   * Use HTTP GET with querystring-encoded `query`/`variables` instead of a
   * POST body. Some CDN-fronted endpoints require this for cached reads.
   */
  useGet?: boolean;
}

/** MCP-specific execution options (Streamable HTTP transport). */
export interface McpOptions {
  /** Absolute HTTP(S) URL of the MCP server endpoint. */
  endpoint?: string;
  /** JSON-RPC method to invoke, e.g. "tools/call", "resources/read", "prompts/get". */
  method?: string;
  /** Tool/resource/prompt name. Folded into `params.name` for tools and prompts. */
  name?: string;
  /** Arguments passed as `params.arguments` (tools) or `params` (others). */
  arguments?: Record<string, unknown>;
  /** Extra headers, merged over `values.header` and auth. */
  headers?: Record<string, string>;
  /** Reuse a previously issued session id instead of re-initializing. */
  sessionId?: string;
  /** Client identity sent during the `initialize` handshake. */
  clientInfo?: { name: string; version: string };
}

/** Bounds applied to the incremental SSE parser itself. */
export interface StreamParserOptions {
  // added
  /**
   * Maximum characters buffered while waiting for an event boundary. A peer
   * that never terminates an event would otherwise grow the buffer without
   * bound, independently of `maxResponseSize`. Defaults to 4 Mi.
   */
  maxBufferChars?: number;
  /** Maximum characters retained in a single event's `data`. Defaults to 1 Mi. */
  maxEventChars?: number;
  /**
   * Attach the last seen `id` to events that omit one. Defaults to true.
   *
   * The specification reserves the last event id for the `Last-Event-ID`
   * header on reconnect rather than treating it as a property of later events.
   * Inheriting it aids debugging but makes `id` look universally present to
   * schema inference. Set to false for a spec-faithful stream.
   */
  inheritEventId?: boolean;
}

export interface SendOptions extends StreamParserOptions {
  /** The complete OpenAPI 3.2 document. */
  spec: OpenApiDocument;
  target: OperationTarget;
  values?: RequestValues;

  /** Overrides `spec.servers[0].url`. */
  serverUrl?: string;
  serverVariables?: Record<string, string>;
  /** Environment variables referenced as {{name}}. */
  variables?: Record<string, string>;
  globals?: Record<string, string>;
  localVariables?: Record<string, string>;

  auth?: AuthConfig;
  scripts?: ScriptConfig;

  /** Full postman-runtime option passthrough. Highest precedence. */
  runner?: RuntimeRunOptions;
  /** WebSocket options, used by the ws adapter. */
  websocket?: WebSocketOptions;
  /** GraphQL options, used by the graphql adapter. */
  graphql?: GraphQLOptions;
  /** MCP options, used by the mcp adapter. */
  mcp?: McpOptions;

  /** Convenience shortcut, equivalent to runner.timeout.request. */
  timeout?: number;
  /** Maximum number of streaming events to retain. */
  maxEvents?: number;
  /** Maximum streaming duration before sampling stops. */
  maxStreamMs?: number;
  maxResponseSize?: number;
  /**
   * Controls the OpenAPI write-back step. Set to false to skip it and leave
   * `patchedSpec` undefined; `responseFragment` is produced either way.
   */
  writeBack?: boolean;

  /** Cancels the run. Sampling stops and a partial result is still returned. */
  signal?: AbortSignal; // added

  /** Callbacks are invoked defensively: a throwing handler never aborts the call. */
  onEvent?: (event: StreamEvent) => void;
  onConsole?: (log: ConsoleLog) => void;
  onAssertion?: (assertion: AssertionResult) => void;
  onResponseStart?: (info: {
    status: number;
    headers: Record<string, string>;
    contentType?: string;
  }) => void;
  /** Fired when a WebSocket connection is established. */
  onOpen?: (info: {
    url: string;
    protocol?: string;
    headers: Record<string, string>;
  }) => void;
}

export interface SendResult extends ExecResult {
  /** The generated Postman collection (v2.1). Empty for non-HTTP protocols. */
  collection?: any;
  /** The generated Postman environment. */
  environment?: any;
  /** OpenAPI 3.2 Response Object derived from the live call. */
  responseFragment: any;
  /** Status code the fragment was filed under. */
  responseStatusCode: string;
  /** Deep copy of the spec with the response merged in. Undefined when skipped. */
  patchedSpec?: OpenApiDocument;
  /** Explains why write-back did not happen. */
  writeBackSkippedReason?: string;
}
