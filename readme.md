# @powerduck/request

Turn an OpenAPI 3.2 document into real HTTP, SSE, and WebSocket traffic — then feed the
responses back into the document as inferred `response` fragments.

`@powerduck/request` runs on top of **postman-runtime**, so everything you already know from
Postman works here: pre-request scripts, test scripts, assertions, variable scopes, dynamic
variables. Nothing is reimplemented, nothing is stripped out.

```bash
npm install @powerduck/request
```

Requires Node.js 18 or newer.

---

## Why

Writing OpenAPI by hand drifts from reality. Recording traffic gives you reality but not a
schema. This library closes the loop: you point it at an operation in your spec, it builds a
Postman collection under the hood, sends the request against a live server, infers a schema
from what actually came back, and merges that schema into your original document — without
clobbering the parts you wrote by hand.

---

## Quick start

```js
import fs from "node:fs/promises";
import { createDebugger } from "@powerduck/request";

const spec = JSON.parse(await fs.readFile("./openapi.json", "utf8"));

const pk = createDebugger();

const result = await pk.send({
  spec,
  target: { operationId: "getUser" },
  values: { path: { id: "1024" } },
  serverUrl: "https://api.example.com/v1",
  auth: { type: "bearer", token: process.env.API_TOKEN },
});

console.log(result.response.status); // 200
console.log(result.responseFragment); // inferred OpenAPI response object
await fs.writeFile(
  "./openapi.json",
  JSON.stringify(result.patchedSpec, null, 2),
);
```

`result.patchedSpec` is your original document with the inferred fragment merged in. If the
write-back was skipped — for example because a test assertion failed — `patchedSpec` is
`undefined` and `writeBackSkippedReason` tells you why.

---

## Core concepts

### The debugger instance

`createDebugger(options)` returns an object with three methods:

| Method                                | Purpose                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `send(request)`                       | Execute one operation and infer its response.                             |
| `sendMany(spec, requests, shared)`    | Execute several operations, accumulating schema changes across the batch. |
| `toCollection(spec, target, options)` | Build a Postman collection and environment **without sending anything**.  |

### Targeting an operation

Either by `operationId`, or by path plus method:

```js
target: { operationId: "getUser" }
target: { path: "/users/{id}", method: "get" }
```

### Supplying values

```js
values: {
  path:   { id: "1024" },
  query:  { include: ["profile", "roles"] },
  header: { "X-Request-Id": "abc" },
  body:   { sku: "A-1", qty: 2 },
}
```

Anything you omit is generated from the schema, honoring `default`, `example`, `examples`,
and `enum`. Generation stops descending at depth 2 and drops optional fields beyond that, so
deeply recursive schemas will not blow up.

### Server resolution

```js
serverUrl: "http://127.0.0.1:4000/v1",              // explicit override, wins over the spec
serverVariables: { host: "staging.example.com" },   // fills in `servers[].variables`
```

---

## Protocols

Protocol selection is automatic. Each registered adapter scores the operation; the highest
score wins, with plain HTTP as the score-1 fallback. `result.protocol` tells you what ran.

### HTTP

The default path. Nothing special required.

### Server-Sent Events

Triggered by a `text/event-stream` response content type. SSE shares the exact same runtime
execution path as regular HTTP — scripts and assertions still run — and events arrive
incrementally through `onEvent`.

```js
const sse = await pk.send({
  spec,
  target: { operationId: "streamChat" },
  values: { body: { model: "demo-model", stream: true, messages } },
  serverUrl: BASE_URL,
  maxEvents: 200,
  maxStreamMs: 60_000,
  onEvent: (event) => {
    if (event.data.trim() === "[DONE]") return;
    process.stdout.write(event.parsed?.choices?.[0]?.delta?.content ?? "");
  },
});

console.log(sse.response.events.length);
console.log(sse.response.truncated); // true if maxEvents or maxStreamMs cut it short
```

The parser handles named events (`event:`), event IDs (`id:`), `retry:`, comment lines, and
multi-line `data:` payloads. Non-JSON payloads such as `[DONE]` are left as raw strings in
`event.data`; `event.parsed` is simply `undefined` for them.

> **Do not pass `requester.maxResponseSize: 0` on a streaming request.** That option is a byte
> ceiling, and `0` means "zero bytes allowed" — it will terminate the stream on the first
> chunk and you will silently receive no events. Omit it, or pass a real limit.

### WebSocket

Triggered by `x-protocol: websocket` on the operation. Backed by the `ws` package on a
separate path from the runtime, so **Postman scripts do not apply to WebSocket sessions**. If
you need assertions there, drive `postman-sandbox` yourself.

```js
const socket = await pk.send({
  spec,
  target: { operationId: "joinRoom" },
  values: { path: { room: "general" }, query: { since: "0" } },
  serverUrl: BASE_URL,
  websocket: {
    subprotocols: ["json.v1"],
    headers: { "X-Client": "powerduck" },
    send: [{ type: "subscribe", channel: "messages" }],
    sendDelayMs: 200,
    maxMessages: 25,
    maxSessionMs: 20_000,
    idleTimeoutMs: 8_000,
    keepAlive: { intervalMs: 10_000, payload: "ping" },
    closeCode: 1000,
    closeReason: "done",
    rejectUnauthorized: true,
  },
  onOpen: (info) => console.log(info.url, info.protocol),
  onEvent: (e) => console.log(e.direction === "out" ? "-->" : "<--", e.data),
});
```

Streaming protocols all normalize into the same `response.events[]` shape, which is what the
write-back layer inspects to build an `itemSchema`.

---

## Scripts and assertions

```js
await pk.send({
  spec,
  target: { operationId: "getUser" },
  values: { path: { id: "1024" } },
  serverUrl: BASE_URL,
  variables: { tenantId: "acme" }, // environment scope
  globals: { appVersion: "2.3.1" }, // global scope

  scripts: {
    collectionPreRequest: {
      exec: [
        "pm.request.headers.upsert({ key: 'X-Tenant', value: pm.environment.get('tenantId') });",
        "pm.request.headers.upsert({ key: 'X-Trace-Id', value: pm.variables.replaceIn('{{$guid}}') });",
      ],
    },
    test: [
      BUILTIN_CAPTURE_TEST,
      {
        id: "latency-budget",
        exec: "pm.test('under 2s', () => pm.expect(pm.response.responseTime).to.be.below(2000));",
      },
    ],
  },

  onConsole: (log) => console.log("[script]", log.level, ...log.messages),
  onAssertion: (a) => console.log(a.passed ? "PASS" : "FAIL", a.name),
  onResponseStart: (info) => console.log(info.status, info.contentType),
});
```

Scripts declared in the spec via `x-postman-scripts` (at document level or operation level)
are picked up automatically and run before the ones you pass inline.

`BUILTIN_CAPTURE_TEST` is an exported script that records the response body for schema
inference. Include it whenever you supply your own `test` array and still want write-back.

---

## Runner options

Every documented `runner.run()` option is forwarded verbatim. Merge precedence is:

```
library defaults  <  convenience fields  <  your `runner` object
```

```js
runner: {
  iterationCount: 1,
  stopOnError: false,
  timeout: { request: 20_000, script: 10_000 },
  delay: { item: 0, iteration: 0 },
  fileResolver: fs,
  requester: {
    strictSSL: true,
    followRedirects: true,
    maxRedirects: 5,
    maxResponseSize: 8 * 1024 * 1024,
    timings: true,
    verbose: true,
    systemHeaders: { "User-Agent": "powerduck-request/0.1.0" },
    network: { restrictedAddresses: { "169.254.169.254": true } },
    agents: {
      http: { agentClass: http.Agent, agentOptions: { keepAlive: true } },
      https: new https.Agent({ keepAlive: true }),
    },
    authorizer: {
      refreshOAuth2Token(id, callback) { callback(null, freshToken); },
    },
  },
  secretResolver({ secrets }, callback) { /* ... */ },
}
```

---

## Schema inference and write-back

```js
const pk = createDebugger({
  writeBack: {
    strategy: "merge", // "merge" | "replace" | "off"
    requirePassingTests: true, // skip write-back if any assertion failed
    protectComponentRefs: true, // never merge into a `$ref` target
    keepExistingDescription: true,
  },
  response: {
    includeExamples: true,
    maxExampleChars: 4000,
  },
});
```

Rules worth knowing before you turn this loose on a real document:

- **`$ref` is never followed for writing.** If a response schema is a reference, the fragment
  is produced but the reference is left untouched. Your shared components stay yours.
- **`required` is intersected across observations.** A field seen in one response but missing
  from another drops out of `required` rather than producing a contradiction.
- **Examples use the OpenAPI 3.1+ array form** (`examples: [...]` inside a schema), which is
  what 3.2 expects — not the deprecated singular `example`.
- **Descriptions you wrote are preserved** when `keepExistingDescription` is on.
- **A failed assertion blocks the merge** when `requirePassingTests` is on, so a broken
  endpoint cannot poison your spec.

---

## Batch replay

`sendMany` threads the evolving spec through the whole list, so later requests see schemas
learned from earlier ones.

```js
const batch = await pk.sendMany(
  spec,
  [
    { target: { operationId: "getUser" }, values: { path: { id: "1" } } },
    { target: { operationId: "getUser" }, values: { path: { id: "2" } } },
    {
      target: { operationId: "createOrder" },
      values: { body: { sku: "A-1", qty: 2 } },
    },
  ],
  { serverUrl: BASE_URL, auth: { type: "bearer", token: TOKEN } },
);

for (const entry of batch.results) {
  if ("error" in entry) console.warn("failed:", entry.error);
  else console.log("ok:", entry.request.method, entry.response.status);
}

await fs.writeFile(
  "./openapi.patched.json",
  JSON.stringify(batch.spec, null, 2),
);
```

One failing request does not abort the batch — failures land in `results` as entries carrying
an `error` field.

---

## Exporting to the Postman app

No network traffic, just artifacts:

```js
const exported = pk.toCollection(
  spec,
  { operationId: "getUser" },
  {
    serverUrl: BASE_URL,
    values: { path: { id: "{{userId}}" } },
    variables: { userId: "1024", token: TOKEN },
    auth: { type: "bearer", token: "{{token}}" },
    scripts: { test: { exec: "pm.test('ok', () => pm.response.to.be.ok);" } },
  },
);

console.log(exported.protocol, exported.streaming);
await fs.writeFile(
  "collection.json",
  JSON.stringify(exported.collection, null, 2),
);
await fs.writeFile(
  "environment.json",
  JSON.stringify(exported.environment, null, 2),
);
```

Both files import directly into Postman.

---

## API reference

### `createDebugger(options?): Debugger`

```ts
interface DebuggerOptions {
  writeBack?: {
    strategy?: "merge" | "replace" | "off";
    requirePassingTests?: boolean;
    protectComponentRefs?: boolean;
    keepExistingDescription?: boolean;
  };
  response?: {
    includeExamples?: boolean;
    maxExampleChars?: number;
  };
}
```

### `send(request): Promise<SendResult>`

```ts
interface SendResult {
  protocol: "http" | "sse" | "websocket" | string;
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
    body?: unknown;
    events?: StreamEvent[];
    truncated?: boolean;
    timings: { durationMs: number; firstByteMs: number };
  };
  scripts?: { passed: boolean; assertions: Assertion[] };
  replays: ReplayRecord[];
  responseFragment: OpenAPIResponseObject;
  patchedSpec?: OpenAPIDocument;
  writeBackSkippedReason?: string;
  error?: Error;
}
```

### Callbacks

| Callback                 | Fires when                                |
| ------------------------ | ----------------------------------------- |
| `onResponseStart(info)`  | Response headers arrive, before the body. |
| `onEvent(event)`         | Each SSE event or WebSocket frame.        |
| `onOpen(info)`           | WebSocket handshake completes.            |
| `onConsole(log)`         | A script calls `console.*`.               |
| `onAssertion(assertion)` | Each `pm.test` resolves.                  |

### Exports

```js
import {
  createDebugger,
  BUILTIN_CAPTURE_TEST,
  registerAdapter,
  ProtocolError,
  SpecError,
} from "@powerduck/request";
```

---

## Extending with a custom protocol

```ts
import { registerAdapter } from "@powerduck/request";

registerAdapter({
  name: "grpc",
  score(operation) {
    return operation["x-protocol"] === "grpc" ? 10 : 0;
  },
  async execute(context) {
    // ...
    return { status: 200, statusText: "OK", headers: {}, events: [], timings };
  },
});
```

Return `events[]` for anything stream-shaped and the inference layer will derive an
`itemSchema` for you with no additional work.

---

## Known limitations

- Aborting a stream at `maxEvents` aborts the run, which means **test scripts do not execute**
  on a truncated stream. Sampling and assertions are mutually exclusive for SSE.
- WebSocket sessions bypass the Postman runtime entirely, so no script or assertion support.
- Referenced schemas (`$ref`) are read but never written.

---

## License

Apache
