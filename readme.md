# @powerduck/openapi-request

OpenAPI 3.2-first protocol debugger for HTTP, SSE, WebSocket, GraphQL, gRPC and MCP.
One client surface, one event model, one write-back pipeline.

## Features

- **OpenAPI 3.2** as the single source of truth — every protocol is an operation with extensions.
- **Incremental SSE / ndjson streaming** with `onEvent` callbacks and `onResponseStart` early classification.
- **Manual sessions** for WebSocket, gRPC (all four RPC modes) and MCP (Streamable HTTP + stdio).
- **gRPC** via reflection or `.proto` files, with metadata / status / trailers surfaced as events.
- **MCP** tools, prompts, resources and resource templates over HTTP or stdio.
- **GraphQL** introspection, query/mutation generation and subscription over WebSocket.
- **Postman-runtime** under the hood for HTTP, with full script (pre-request / test) support.
- **Response write-back** — merges live responses into the OpenAPI document as `responses` objects.

## Installation

```bash
npm install @powerduck/openapi-request
```

Requires Node.js >= 18.17.

## Quick Start

```ts
import { createClient } from "@powerduck/openapi-request";

const client = createClient();

// 1. Decide how to render before sending anything.
const prepared = client.prepare({
  spec: openApiDoc,
  target: { path: "/users/{id}", method: "get" },
});
console.log(prepared.display.mode);   // "response" | "event-list" | "duplex-session"
console.log(prepared.stream.kind);    // "none" | "sse" | "grpc-unary" | ...

// 2. Send a one-shot request (HTTP / GraphQL / MCP one-shot).
const result = await client.send({
  spec: openApiDoc,
  target: { path: "/users/{id}", method: "get" },
  values: { path: { id: "42" } },
  serverUrl: "https://api.example.com",
  onResponseStart: (info) => {
    console.log("streaming:", info.streaming); // true for SSE, switch UI early
  },
  onEvent: (event) => {
    console.log(event.event, event.data); // incremental SSE events
  },
});

// 3. Open a long-lived session (WebSocket / gRPC / MCP).
const session = client.connect({ kind: "websocket", url: "wss://api.example.com/ws" });
await session.open();
session.onEvent((e) => console.log(e));
await session.send({ type: "ping" });
await session.close();
```

---

## API Reference

### `createClient(options?)`

Returns a client with `prepare`, `send`, `sendMany`, `connect`, `discover`, `writeback`, `dispose`, `probeStreamingResponse`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `writeBack` | `WriteBackOptions` | `{}` | Controls how responses are merged into the spec. |
| `response` | `ToResponseOptions` | `{}` | Controls how a live response becomes an OpenAPI Response object. |

### `client.prepare(options)` → `PreparedRequest`

Pure, synchronous. No I/O. Returns everything the UI needs to choose a renderer.

| Field | Type | Description |
|-------|------|-------------|
| `protocol` | `string` | `"http"` \| `"sse"` \| `"websocket"` \| `"grpc"` \| `"graphql"` \| `"mcp"` |
| `transport` | `string` | `"http"` \| `"websocket"` \| `"grpc"` \| `"stdio"` |
| `display.mode` | `"response"` \| `"event-list"` \| `"duplex-session"` | How to render the result. |
| `stream.kind` | `StreamKind` | Fine-grained streaming taxonomy. |
| `stream.expected` | `boolean` | True when the operation declares or implies streaming. |
| `openapi.extensions` | `Record<string, unknown>` | The seven `x-*` extensions derived from the operation. |
| `warnings` | `string[]` | Non-fatal issues found during preparation. |

### `client.send(options)` → `Promise<SendResult>`

One-shot execution through the full pipeline: build collection → run → parse → write back.

### `client.connect(options)` → `ManualSession`

Opens a long-lived session for WebSocket, gRPC or MCP. See [Manual Sessions](#manual-sessions).

### `client.discover(options)` → `Promise<DiscoveryResult>`

Discovers schema/capabilities for MCP or gRPC.

| Protocol | Options |
|----------|---------|
| `mcp` | `{ protocol: "mcp", endpoint, headers?, transport?, command?, args?, cwd? }` |
| `grpc` | `{ protocol: "grpc", address, reflection?, protoPaths?, includeDirs?, metadata?, channelOptions? }` |

### `client.writeback(spec, prepared, result, options?)` → `OpenApiDocument`

Merges a result's response into the spec at the operation's path+method.

---

## SendOptions (all protocols)

The full option shape passed to `client.send()`. Protocol-specific fields are nested under `runner`, `websocket`, `graphql`, `mcp`, `grpc`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `spec` | `OpenApiDocument` | **required** | The OpenAPI 3.2 document. |
| `target` | `OperationTarget` | **required** | `{ path?, method?, operationId? }` — identifies the operation. |
| `values` | `RequestValues` | `{}` | Path/query/header/cookie/body values to inject. |
| `serverUrl` | `string` | `spec.servers[0].url` | Overrides the server URL. |
| `serverVariables` | `Record<string,string>` | `{}` | Variables for `{var}` placeholders in the server URL. |
| `variables` | `Record<string,string>` | `{}` | Postman environment variables (`{{name}}`). |
| `globals` | `Record<string,string>` | `{}` | Postman global variables. |
| `localVariables` | `Record<string,string>` | `{}` | Postman local variables. |
| `auth` | `AuthConfig` | — | `{ type: "bearer"\|"basic"\|"apikey"\|"none", ... }`. |
| `scripts` | `ScriptConfig` | `{}` | Pre-request / test scripts and `x-postman-scripts` handling. |
| `runner` | `RuntimeRunOptions` | `{}` | Full postman-runtime passthrough. Highest precedence. |
| `websocket` | `WebSocketOptions` | `{}` | WebSocket-specific options. |
| `graphql` | `GraphQLOptions` | `{}` | GraphQL-specific options. |
| `mcp` | `McpOptions` | `{}` | MCP-specific options. |
| `grpc` | `any` | `{}` | gRPC-specific options (used by the gRPC adapter). |
| `timeout` | `number` | `30000` | Convenience shortcut for `runner.timeout.request`. `0` = unlimited. |
| `maxEvents` | `number` | `100` | Maximum streaming events to retain. |
| `maxStreamMs` | `number` | `30000` | Maximum streaming duration before sampling stops. |
| `maxResponseSize` | `number` | — | Hard byte ceiling for the response body. Rejected if `<= 0`. |
| `writeBack` | `boolean` | `true` | Set `false` to skip OpenAPI write-back. |
| `signal` | `AbortSignal` | — | Cancels the run; returns a partial result. |
| `onEvent` | `(event: StreamEvent) => void` | — | Incremental SSE / ndjson events. Called defensively (errors swallowed). |
| `onResponseStart` | `(info: ResponseStartInfo) => void` | — | Fires when headers arrive. `info.streaming` is the early SSE flag. |
| `onConsole` | `(log: ConsoleLog) => void` | — | Script `console.*` output. |
| `onAssertion` | `(a: AssertionResult) => void` | — | Individual test assertion results. |
| `onOpen` | `(info: {url, protocol?, headers}) => void` | — | WebSocket connection established. |

### StreamParserOptions (also on SendOptions)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxBufferChars` | `number` | `4194304` (4 Mi) | Max chars buffered while waiting for an event boundary. |
| `maxEventChars` | `number` | `1048576` (1 Mi) | Max chars in a single event's `data`. |
| `inheritEventId` | `boolean` | `true` | Attach the last seen `id` to events that omit one. Set `false` for spec-faithful streams. |

---

## HTTP / SSE

### Request JSON structure

An HTTP operation is a standard OpenAPI path item. SSE is detected automatically from the response content type or the `x-response-stream` extension.

```json
{
  "openapi": "3.2.0",
  "info": { "title": "example", "version": "1.0.0" },
  "servers": [{ "url": "https://api.example.com" }],
  "paths": {
    "/users/{id}": {
      "get": {
        "operationId": "getUser",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": { "application/json": {} }
          }
        }
      }
    },
    "/events": {
      "get": {
        "operationId": "streamEvents",
        "responses": {
          "200": {
            "description": "ok",
            "content": { "text/event-stream": {} }
          }
        }
      }
    }
  }
}
```

### `runner.requester` options (HTTP transport)

These control the underlying HTTP client. Pass via `send({ runner: { requester: { ... } } })`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `followRedirects` | `boolean` | `true` | Follow HTTP 3xx redirects. |
| `followOriginalHttpMethod` | `boolean` | `false` | Keep the original method on redirect (e.g. POST stays POST). When `false`, 301/302/303 downgrade to GET. |
| `maxRedirects` | `number` | `10` | Maximum redirect hops. Must be a non-negative integer. |
| `protocolVersion` | `"http1" \| "http2" \| "auto"` | `"http1"` | HTTP protocol version. `"http1"` is required for SSE chunked streaming; use `"auto"` for HTTP/2 endpoints. |
| `strictSSL` | `boolean` | `true` | Reject self-signed / invalid TLS certificates. |
| `insecureHTTPParser` | `boolean` | `false` | Allow invalid HTTP responses (e.g. malformed headers). |
| `maxResponseSize` | `number` | — | Hard byte ceiling for the response body. `0` is rejected (would silently yield empty streams). Omit for unbounded. |
| `maxHeaderSize` | `number` | — | Maximum response header size in bytes. |
| `useWhatWGUrlParser` | `boolean` | `true` | Use the WHATWG URL parser for request URLs. |
| `removeRefererHeaderOnRedirect` | `boolean` | `false` | Strip the `Referer` header when following a redirect. |
| `timings` | `boolean` | `true` | Collect detailed timing data (powers `firstByteMs`, `networkDurationMs`). |
| `verbose` | `boolean` | `true` | Keep request/response history (powers `replays`). |
| `implicitCacheControl` | `boolean` | `true` | Add `Cache-Control: no-cache` implicitly. |
| `implicitTraceHeader` | `boolean` | `true` | Add a trace header implicitly. |
| `disableCookies` | `boolean` | `false` | Disable the cookie jar. |
| `cookieJar` | `any` | — | Custom cookie jar instance. |
| `systemHeaders` | `Record<string,string>` | — | Headers added to every request (e.g. `User-Agent`). |
| `extendedRootCA` | `string` | — | Path to an additional CA bundle. |
| `encoding` | `null \| string` | `null` | Response body encoding. **Must be `null` for incremental SSE streaming** — the default `utf8` buffers the body to decode multi-byte boundaries. |
| `agents` | `{ http?, https? }` | — | Custom HTTP/HTTPS agents. Supplying agents disables the library's socket tracking (stream cancellation falls back to `run.abort()`). |
| `network.hostLookup` | `{ type, hostIpMap? }` | — | Custom DNS resolution. |
| `network.restrictedAddresses` | `Record<string,boolean>` | — | Block specific IP addresses (SSRF protection). |
| `maxInvokableNestedRequests` | `number` | `5` | Max nested requests from scripts (`pm.sendRequest`). |
| `sslKeyLogFile` | `string` | — | Path to write TLS session keys (for Wireshark debugging). |

### `runner` top-level options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout.request` | `number` | `30000` | Per-request timeout in ms. `0` = unlimited. |
| `timeout.script` | `number` | `15000` | Script execution timeout in ms. |
| `timeout.global` | `number` | computed | Global run timeout. Derived from `request + streamBudget + 15000` slack. |
| `iterationCount` | `number` | `1` | Number of iterations. Must be >= 1. |
| `data` | `Array<Record<string,unknown>>` | — | Data-driven iteration values. When provided, `iterationCount` defaults to `data.length`. |
| `stopOnError` | `boolean` | `false` | Halt the run on a request error. |
| `abortOnError` | `boolean` | `false` | Abort immediately on error (no cleanup callbacks). |
| `stopOnFailure` | `boolean` | `false` | Halt on a failed test assertion. |
| `abortOnFailure` | `boolean` | `false` | Abort immediately on assertion failure. |
| `environment` | `any` | built from `variables` | Postman environment. Override to supply a custom VariableScope. |
| `globals` | `any` | built from `globals` | Postman globals. |
| `localVariables` | `any` | built from `localVariables` | Postman local variables. |
| `proxies` | `any` | — | Postman proxy configuration list. |
| `systemProxy` | `(url, cb) => void` | — | Callback to resolve the system proxy for a URL. |
| `ignoreProxyEnvironmentVariables` | `boolean` | `false` | Ignore `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` env vars. |
| `certificates` | `any` | — | Client certificate list. |
| `delay.item` | `number` | `0` | Delay between requests in ms. |
| `delay.iteration` | `number` | `0` | Delay between iterations in ms. |
| `entrypoint.execute` | `string` | — | Name of the item to start from. |
| `entrypoint.lookupStrategy` | `"idOrName" \| "path"` | — | How to resolve the entrypoint. |
| `secretResolver` | `(ctx, cb) => void` | — | Resolve secrets referenced in the collection. |
| `fileResolver` | `unknown` | — | Resolve file references in request bodies. |

### SSE streaming example

```ts
const result = await client.send({
  spec,
  target: { path: "/events", method: "get" },
  maxStreamMs: 60000,
  maxEvents: 100,
  onResponseStart: (info) => {
    if (info.streaming) {
      // Switch the UI to the event-list view immediately — do not wait
      // for send() to resolve.
      renderEventList();
    }
  },
  onEvent: (event) => {
    appendEvent(event); // called incrementally, ~every chunk
  },
});

// result.response.events contains all retained events.
// result.response.truncated / stopReason explain why sampling ended.
```

---

## WebSocket

### Request JSON structure

```json
{
  "paths": {
    "/ws": {
      "get": {
        "operationId": "wsConnect",
        "x-protocol": "websocket",
        "x-ws": {
          "url": "wss://api.example.com/ws",
          "subprotocols": ["graphql-transport-ws"]
        },
        "responses": { "200": { "description": "duplex" } }
      }
    }
  }
}
```

### `websocket` options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` | from `x-ws.url` | Absolute `ws://` or `wss://` URL. Overrides the spec. |
| `subprotocols` | `string[]` | `[]` | WebSocket subprotocols to negotiate. |
| `headers` | `Record<string,string>` | `{}` | Extra handshake headers. |
| `send` | `Array<string \| object \| Uint8Array>` | — | Messages sent immediately after open. |
| `sendDelayMs` | `number` | — | Delay between consecutive `send` messages. |
| `maxMessages` | `number` | — | Stop after this many inbound messages. |
| `maxSessionMs` | `number` | — | Hard cap on total session duration. |
| `idleTimeoutMs` | `number` | — | Close when no message arrives within this window. |
| `keepAlive` | `{ intervalMs, payload? }` | — | Application-level ping on an interval. |
| `closeCode` | `number` | `1000` | Close code sent when terminating. |
| `closeReason` | `string` | `"Closed"` | Close reason text. |
| `closeTimeoutMs` | `number` | — | Grace period for the peer's close frame before destroying the socket. |
| `rejectUnauthorized` | `boolean` | `true` | Reject self-signed TLS certificates. |
| `maxPayloadBytes` | `number` | — | Cap on retained payload size per frame. |
| `handshakeTimeoutMs` | `number` | `15000` | Handshake timeout. |
| `clientOptions` | `Record<string,unknown>` | `{}` | Extra options forwarded to the `ws` constructor. |

### Manual WebSocket session

```ts
const session = client.connect({
  kind: "websocket",
  url: "wss://api.example.com/ws",
  subprotocols: ["chat"],
  headers: { Authorization: "Bearer xxx" },
});

session.onEvent((e) => {
  // e.kind: "open" | "text" | "binary" | "error" | "close" | "upgrade"
  // e.direction: "in" | "out" | "meta"
  // e.data: text payload (or base64 for binary)
});

await session.open();
await session.send({ type: "subscribe", channel: "updates" });
await session.close({ code: 1000, reason: "done" });
```

---

## GraphQL

### Request JSON structure

```json
{
  "paths": {
    "/graphql": {
      "post": {
        "operationId": "graphqlQuery",
        "x-protocol": "graphql",
        "x-graphql": {
          "endpoint": "https://api.example.com/graphql",
          "operationType": "query",
          "operationName": "GetUser",
          "query": "query GetUser($id: ID!) { user(id: $id) { name } }",
          "variablesSchema": {
            "type": "object",
            "properties": { "id": { "type": "string" } },
            "required": ["id"]
          }
        },
        "requestBody": {
          "content": { "application/json": { "schema": { "type": "object" } } }
        },
        "responses": { "200": { "description": "ok" } }
      }
    }
  }
}
```

### `graphql` options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `endpoint` | `string` | from `x-graphql.endpoint` | Absolute HTTP(S) URL of the GraphQL endpoint. |
| `query` | `string` | from `x-graphql.query` | Query or mutation document. Overrides the spec. |
| `operationName` | `string` | from `x-graphql.operationName` | Required when `query` declares more than one operation. |
| `variables` | `Record<string,unknown>` | `{}` | GraphQL variables. Merged over sampled values. |
| `headers` | `Record<string,string>` | `{}` | Extra headers, merged over `values.header` and auth. |
| `useGet` | `boolean` | `false` | Use HTTP GET with querystring-encoded `query`/`variables` instead of POST. |

### GraphQL discovery (introspection)

```ts
const result = await client.discover({
  protocol: "graphql",
  endpoint: "https://countries.trevorblades.com/",
  headers: { Authorization: "Bearer xxx" },
});
// result.discovery contains the introspected schema
```

---

## gRPC

### Request JSON structure

```json
{
  "paths": {
    "/grpc": {
      "post": {
        "operationId": "grpcCall",
        "x-protocol": "grpc",
        "x-grpc": {
          "address": "127.0.0.1:50051",
          "service": "demo.echo.Echo",
          "method": "Say",
          "kind": "unary",
          "reflection": true
        },
        "responses": { "200": { "description": "ok" } }
      }
    }
  }
}
```

### gRPC method kinds

| Kind | Streaming | Interaction | Button label |
|------|-----------|-------------|-------------|
| `unary` | none | One request → one response. Session closes automatically. | "Send and await" |
| `server_streaming` | server → client | One request → N responses. Session closes on stream end. | "Send and await" |
| `client_streaming` | client → server | N requests → one response. Send messages, then Finish. | "Send message" + "Finish" |
| `bidi_streaming` | both | N requests ↔ N responses. Full duplex. | "Send message" + "Finish" |

### Manual gRPC session options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `address` | `string` | **required** | `host:port`, no scheme. |
| `service` | `string` | **required** | Fully-qualified service name, e.g. `"demo.echo.Echo"`. |
| `method` | `string` | **required** | Method name as declared in proto. Matched case-insensitively as fallback. |
| `reflection` | `boolean` | — | Set `true` to use server reflection. Mutually exclusive with `protoPaths`. |
| `protoPaths` | `string[]` | — | `.proto` files or directories. Directories are walked recursively. |
| `includeDirs` | `string[]` | derived | Import roots for proto-loader. |
| `metadata` | `Record<string, string \| string[]>` | `{}` | gRPC metadata sent on every call. |
| `deadlineMs` | `number` | — | Per-call deadline. Enforced by the server (yields DEADLINE_EXCEEDED). |
| `channelOptions` | `Record<string,unknown>` | `{}` | grpc-js channel options. |
| `tls` | `boolean \| GrpcTlsOptions` | — | `false`/undefined = insecure; `true` = TLS with system roots; object = custom TLS. |
| `loaderOptions` | `Record<string,unknown>` | `{}` | Extra proto-loader options. |
| `reflectionTimeoutMs` | `number` | `5000` | Budget for the whole reflection session. |
| `reflectionVersion` | `"v1" \| "v1alpha"` | try v1, fall back | Pin a reflection version. |
| `reflectionHost` | `string` | — | `host` field on reflection requests (virtual-hosted servers). |

### gRPC TLS options

| Field | Type | Description |
|-------|------|-------------|
| `rootCerts` | `Buffer` | CA bundle contents (not a path). Pass `await readFile(p)`. |
| `privateKey` | `Buffer` | Client key for mTLS. Must be given with `certChain`. |
| `certChain` | `Buffer` | Client certificate chain for mTLS. Must be given with `privateKey`. |
| `skipHostnameVerification` | `boolean` | Skip hostname verification only. Chain is still verified. Always produces a warning. |

### gRPC session events

| `kind` | `direction` | Payload |
|--------|-------------|---------|
| `open` | `meta` | `{ address, service, method, kind, descriptorSource }` |
| `metadata` | `meta` | Response headers (initial metadata). |
| `data` | `out` | Outbound request message. |
| `data` | `in` | Inbound response message. |
| `status` | `meta` | Terminal status: `{ code, statusName, details, metadata }` (trailers). |
| `error` | `meta` | Error: `{ code, statusName, details, error }`. |
| `end` | `meta` | Stream ended. |
| `close` | `meta` | Session closed by the client. |

### gRPC example

```ts
const session = client.connect({
  kind: "grpc",
  address: "127.0.0.1:50051",
  reflection: true,
  service: "demo.echo.Echo",
  method: "Say",
});

session.onEvent((e) => {
  if (e.kind === "status") {
    console.log("status:", e.meta.code, e.meta.statusName);
  }
});

await session.open();
await session.send({ text: "hello" });
// session.state === "closed" after a unary call
```

---

## MCP (Model Context Protocol)

### Request JSON structure

```json
{
  "paths": {
    "/mcp": {
      "post": {
        "operationId": "mcpCall",
        "x-protocol": "mcp",
        "x-transport": "http",
        "x-mcp": {
          "endpoint": "http://127.0.0.1:4200/mcp",
          "method": "tools/call",
          "name": "get_weather",
          "arguments": { "city": "SF" }
        },
        "responses": { "200": { "description": "ok" } }
      }
    }
  }
}
```

### `mcp` options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `transport` | `"streamable-http" \| "stdio"` | `"streamable-http"` | Wire transport. |
| `endpoint` | `string` | from `x-mcp.endpoint` | Absolute http(s) URL for Streamable HTTP transport. |
| `headers` | `Record<string,string>` | `{}` | Extra HTTP headers. |
| `command` | `string` | — | stdio command (e.g. `"npx"`). Required for stdio. |
| `args` | `string[]` | `[]` | stdio command arguments. |
| `cwd` | `string` | — | Working directory for the stdio child. |
| `env` | `Record<string,string \| undefined>` | — | Environment for the stdio child. |
| `timeoutMs` | `number` | `30000` | Per-request timeout. `0` disables. |
| `maxBufferBytes` | `number` | — | stdio stdout buffer cap. |
| `maxStderrBytes` | `number` | — | stdio stderr cap before the child is killed. |
| `method` | `string` | from `x-mcp.method` | JSON-RPC method, e.g. `"tools/call"`. |
| `name` | `string` | from `x-mcp.name` | Target tool/prompt/resource name. |
| `arguments` | `Record<string,unknown>` | `{}` | JSON-RPC params. |
| `sessionId` | `string` | — | Reuse an existing MCP session ID. |
| `protocolVersion` | `string` | — | MCP protocol version to negotiate. |
| `clientInfo` | `{ name, version }` | `{ name: "powerduck", version: "0.1.0" }` | Client info sent in `initialize`. |

### Manual MCP session

```ts
const session = client.connect({
  kind: "mcp",
  transport: "streamable-http",
  endpoint: "http://127.0.0.1:4200/mcp",
});

await session.open();

// List capabilities
const tools = await session.listTools();
const prompts = await session.listPrompts();
const resources = await session.listResources();

// Call a tool
const result = await session.callTool("get_weather", { city: "SF" });

// Raw JSON-RPC
const raw = await session.request("tools/call", { name: "x", arguments: {} });

await session.close();
```

### MCP stdio session

```ts
const session = client.connect({
  kind: "mcp",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-everything"],
  cwd: "/path/to/project",
});
await session.open();
```

---

## Manual Sessions (unified API)

All manual sessions (WebSocket, gRPC, MCP) share this contract:

| Method / Property | Description |
|-------------------|-------------|
| `protocol` | `"websocket"` \| `"grpc"` \| `"mcp"` |
| `state` | `"idle"` \| `"connecting"` \| `"open"` \| `"closing"` \| `"closed"` \| `"error"` |
| `events` | Read-only array of all events (ring-buffered at 1000 by default). |
| `onEvent(listener)` | Subscribe to events. Returns `{ unsubscribe() }`. |
| `open()` | Connect / initialize. Rejects from non-idle states. |
| `send(message, options?)` | Send a message. Rejects when not open. |
| `close(options?)` | Close gracefully. Idempotent. |
| `waitForClose()` | Promise that resolves when the session closes. |

### SessionEventDTO

| Field | Type | Description |
|-------|------|-------------|
| `protocol` | `string` | Protocol name. |
| `transport` | `string` | Transport label. |
| `sessionId` | `string` | Unique session identifier. |
| `direction` | `"in" \| "out" \| "meta"` | Message direction. |
| `kind` | `string` | Event discriminator (protocol-specific). |
| `at` | `number` | Epoch ms timestamp. |
| `state` | `SessionState?` | Session state at the time of the event. |
| `data` | `Cloneable?` | Message payload. |
| `error` | `Cloneable?` | Error payload. |
| `meta` | `Cloneable?` | Metadata (headers, status code, etc.). |

---

## SendResult

| Field | Type | Description |
|-------|------|-------------|
| `protocol` | `ProtocolName` | `"http"` \| `"sse"` \| etc. |
| `request` | `{ method, url, headers, body? }` | The request that was sent. |
| `response.status` | `number` | HTTP status code. `0` if no response. |
| `response.statusText` | `string` | Status text. |
| `response.headers` | `Record<string,string>` | Response headers (case preserved). |
| `response.contentType` | `string?` | Parsed content type. |
| `response.body` | `unknown` | Parsed body (non-streaming). |
| `response.text` | `string?` | Raw body text. |
| `response.events` | `StreamEvent[]` | Collected streaming events. |
| `response.timings` | `{ startedAt, endedAt, durationMs, firstByteMs?, networkDurationMs? }` | Timing data. |
| `response.sizeBytes` | `number` | Body bytes received. |
| `response.truncated` | `boolean?` | True if sampling stopped before natural completion. |
| `response.stopReason` | `StopReason?` | Which limit fired: `"maxEvents" \| "maxStreamMs" \| "maxResponseSize" \| "aborted" \| "hardTimeout"`. |
| `response.droppedEvents` | `number?` | Events discarded by the parser's size caps. |
| `scripts` | `ScriptReport?` | Pre-request / test script results. |
| `cookies` | `Array<{name, value, domain?, path?}>` | Cookies set by the response. |
| `replays` | `ReplayRecord[]` | Auxiliary traffic (OAuth refreshes, redirects). |
| `error` | `{ message, code?, name?, stack? }?` | Fatal error, if any. |
| `collection` | `any` | Generated Postman collection (HTTP only). |
| `environment` | `any` | Generated Postman environment. |
| `responseFragment` | `any` | OpenAPI Response object derived from the live call. |
| `responseStatusCode` | `string` | Status code the fragment was filed under. |
| `patchedSpec` | `OpenApiDocument?` | Spec with the response merged in. |
| `writeBackSkippedReason` | `string?` | Why write-back was skipped. |

---

## Error Handling

All errors are thrown as `ProtoKitError` with a machine-readable `code`:

| Code | Meaning |
|------|---------|
| `BAD_OPTIONS` | Missing or invalid send options. |
| `BAD_RUN_OPTIONS` | Invalid runtime options (e.g. `maxResponseSize: 0`). |
| `BAD_COLLECTION` | Failed to construct the Postman collection. |
| `RUNTIME_INIT` | postman-runtime failed to initialize. |
| `RUNTIME_RUN` | The run failed with a done error. |
| `EXECUTION_FAILED` | A protocol adapter threw. |
| `BAD_MCP_ENDPOINT` | Invalid MCP endpoint URL. |
| `BAD_MCP_STDIO_COMMAND` | Missing stdio command. |
| `MCP_TIMEOUT` | MCP request or initialize timed out. |
| `MCP_NOT_OPEN` | Called before `open()`. |
| `MCP_SESSION_CLOSED` | Called on a closed session. |
| `MCP_SESSION_EXPIRED` | Server returned 404 for the session. |
| `MCP_RPC_ERROR` | JSON-RPC error response. |
| `MCP_EMPTY_RESPONSE` | No JSON-RPC message in the response. |

```ts
import { ProtoKitError } from "@powerduck/openapi-request";

try {
  await client.send(options);
} catch (err) {
  if (err instanceof ProtoKitError) {
    console.error(err.code, err.message);
  }
}
```

---

## Development

```bash
npm install
npm run build       # tsup → dist/
npm test            # vitest run (107 tests)
npm run typecheck   # tsc --noEmit
```

### Test layout

| File | Coverage |
|------|----------|
| `tests/sse-parser.test.ts` | 29 tests — SSE parser edge cases, size caps, chunk boundaries. |
| `tests/runner-options.test.ts` | 19 tests — HTTP option validation and defaults. |
| `tests/session-hub.test.ts` | 9 tests — event hub, listener safety, ring buffer. |
| `tests/grpc-session.test.ts` | 10 tests — unary success/error state, streaming, lifecycle. |
| `tests/ws-session.test.ts` | 10 tests — connect, send/receive, error state, lifecycle. |
| `tests/client.test.ts` | 8 tests — prepare() protocol inference. |
| `tests/session.test.ts` | 6 tests — unified createManualSession routing. |
| `tests/integration.test.ts` | 4 tests — end-to-end HTTP + SSE streaming. |
| `tests/clone.test.ts` | 8 tests — payload cloning. |
| `tests/detect.test.ts` | 4 tests — SSE content-type detection. |

## License

MIT
