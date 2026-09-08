# @powerduck/request

OpenAPI 3.2 protocol toolkit: HTTP/SSE, WebSocket, GraphQL, MCP (Streamable
HTTP + stdio), gRPC (unary / server / client / bidi). Every protocol plugs into
the OpenAPI 3.2 `x-protocol` write-back pipeline, and every connect-first
protocol has a manual session under one unified event contract.

## Highlights

- **One entry, two personas**
  - `createClient()` — UI-first surface: `prepare()` (decide the renderer
    before sending), `send()`, `connect()`, `discover()`, `writeback()`,
    `probeStreamingResponse()`.
  - `createDebugger()` — scripted workhorse: `send()`, `sendMany()`,
    `toCollection()`.
- **Decide the renderer before the first byte** — `prepare()` returns
  `display.mode` (`response` | `event-list` | `duplex-session`) and
  `stream.kind` (12-value taxonomy) from the OpenAPI document alone;
  `probeStreamingResponse()` classifies live response headers when the
  document is silent.
- **One event contract** — every session (ws / mcp / grpc) reports through
  `SessionEventDTO` (`{ direction, kind, at, state, data, meta, error }`)
  with `onEvent()` subscriptions and a bounded ring buffer.
- **One types file** — `src/types.ts` is the single public type surface.
- **MCP dual transport** — Streamable HTTP and stdio, tools / resources /
  prompts discovery + call, exposed both as sessions and OpenAPI operations.
- **gRPC four modes** — unary / server-stream / client-stream / bidi, with
  proto-file and reflection discovery and response write-back.
- **Shared utils** — duplicate helpers collapsed into `src/core/utils.ts`,
  `toCloneable()` normalizes every event payload for IPC safety.

## Install & build

```bash
npm install
npm run build      # dist/index.js (single-file ESM) + dist/*.d.ts
npm test           # vitest (unit + integration against real local servers)
npm run typecheck
```

## Usage

### UI-first: prepare, send, write back

```js
import { createClient } from "@powerduck/request";

const client = createClient();
const prepared = client.prepare({ spec, target: { operationId: "streamChat" } });

if (prepared.display.mode === "event-list") {
  // render a streaming list; stream.kind tells you the wire format
} else {
  // render a plain response box
}

const result = await client.send({ spec, target: prepared.target });
const patched = client.writeback(spec, prepared, result);
```

### Early SSE detection

`onResponseStart` fires with `{ streaming, protocol, url }` as soon as
headers arrive, and `probeStreamingResponse(url)` classifies a live endpoint
before the UI commits to a renderer.

### Long-lived sessions

```js
import { createManualSession } from "@powerduck/request";

const ws = createManualSession({ kind: "websocket", url: "ws://..." });
ws.onEvent((e) => console.log(e.direction, e.kind, e.data));
await ws.open();
await ws.send({ text: "ping" });

const mcp = createManualSession({ kind: "mcp", endpoint: "http://..." });
const grpc = createManualSession({
  kind: "grpc", address: "127.0.0.1:50051",
  protoPaths: ["proto/echo.proto"], service: "echo.Echo", method: "UnaryEcho",
});
```

## Examples & tests

`examples/` holds self-contained demos (each with a local fixture server),
`tests/` runs unit and integration suites against those servers.

```bash
bash run-examples.sh   # starts all fixture servers, runs every demo
```

## License

Internal use.
