export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type ProtocolName = "http" | "sse" | "websocket" | "grpc" | "mcp";

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
  /** Read `x-postman-scripts` from the spec. Defaults to true. */
  fromSpecExtensions?: boolean;
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
  /** Values produced by pm.execution.setNextRequest / skipRequest, etc. */
  return?: Record<string, unknown>;
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
  /** Message direction. WebSocket only; SSE is always inbound. */
  direction?: "in" | "out";
}

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
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    contentType?: string;
    /** Parsed body for non-streaming responses. */
    body?: unknown;
    text?: string;
    /** Collected events for streaming protocols. */
    events?: StreamEvent[];
    timings: {
      startedAt: number;
      endedAt: number;
      durationMs: number;
      firstByteMs?: number;
    };
    sizeBytes: number;
    /** True when sampling stopped before the stream ended naturally. */
    truncated?: boolean;
  };
  scripts?: ScriptReport;
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
  replays?: ReplayRecord[];
  error?: { message: string; code?: string; name?: string };
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
  /** Extra options forwarded verbatim to the `ws` client constructor. */
  clientOptions?: Record<string, unknown>;
  /** Reject self-signed certificates. Defaults to true. */
  rejectUnauthorized?: boolean;
  /** Cap on retained binary payload size, in bytes. */
  maxPayloadBytes?: number;
}

export interface SendOptions {
  /** The complete OpenAPI 3.2 document. */
  spec: any;
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

  /** Convenience shortcut, equivalent to runner.timeout.request. */
  timeout?: number;
  /** Maximum number of streaming events to retain. */
  maxEvents?: number;
  /** Maximum streaming duration before sampling stops. */
  maxStreamMs?: number;

  /** Skip the OpenAPI write-back step. Defaults to false. */
  writeBack?: boolean;

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
  patchedSpec?: any;
  /** Explains why write-back did not happen. */
  writeBackSkippedReason?: string;
}
