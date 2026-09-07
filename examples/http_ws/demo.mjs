import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { createDebugger, BUILTIN_CAPTURE_TEST } from "../../dist/index.js";

const spec = JSON.parse(
  await fs.readFile(new URL("./openapi.json", import.meta.url), "utf8"),
);
const BASE_URL = process.env.BASE_URL ?? "http://cc.apipost.cc:6002";
const TOKEN = process.env.API_TOKEN ?? "";

const pk = createDebugger({
  writeBack: {
    strategy: "merge",
    requirePassingTests: true,
    protectComponentRefs: true,
    keepExistingDescription: true,
  },
  response: { includeExamples: true, maxExampleChars: 4000 },
});

/* ------------------------------------------------------------------ */
/* 1. Plain HTTP with scripts and full runtime option passthrough       */
/* ------------------------------------------------------------------ */

const httpResult = await pk.send({
  spec,
  target: { path: "/users/{id}", method: "get" },
  values: {
    path: { id: "1024" },
    query: { include: ["profile", "roles"] },
  },
  serverUrl: BASE_URL,
  serverVariables: { host: "cc.apipost.cc:6002" },
  variables: { tenantId: "acme" },
  globals: { appVersion: "2.3.1" },
  auth: { type: "bearer", token: TOKEN },

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
        exec: [
          "pm.test('responds within 2s', function () {",
          "  pm.expect(pm.response.responseTime).to.be.below(2000);",
          "});",
        ],
      },
    ],
  },

  // Every documented postman-runtime option is forwarded verbatim.
  runner: {
    iterationCount: 1,
    stopOnError: false,
    abortOnFailure: false,
    timeout: { request: 20_000, script: 10_000 },
    delay: { item: 0, iteration: 0 },
    fileResolver: fs,
    requester: {
      strictSSL: true,
      followRedirects: true,
      maxRedirects: 5,
      maxResponseSize: 8 * 1024 * 1024,
      protocolVersion: "auto",
      timings: true,
      verbose: true,
      systemHeaders: { "User-Agent": "ProtoKit/0.1.0" },
      network: { restrictedAddresses: { "169.254.169.254": true } },
      agents: {
        http: { agentClass: http.Agent, agentOptions: { keepAlive: true } },
        https: new https.Agent({ keepAlive: true }),
      },
      authorizer: {
        refreshOAuth2Token(id, callback) {
          callback(null, process.env.REFRESHED_TOKEN ?? "");
        },
      },
    },
    script: {
      serializeLogs: false,
      packageResolver({ packages }, callback) {
        callback(null, {});
      },
    },
    secretResolver({ secrets }, callback) {
      callback(
        null,
        secrets.map((secret) => ({
          resolvedValue: process.env[secret.key] ?? "",
          allowedInScript: false,
        })),
      );
    },
    ignoreProxyEnvironmentVariables: false,
  },

  onConsole: (log) => console.log("[script]", log.level, ...log.messages),
  onAssertion: (a) =>
    console.log(a.passed ? "  PASS" : "  FAIL", a.name, a.error?.message ?? ""),
  onResponseStart: (info) =>
    console.log("headers received:", info.status, info.contentType),
});

console.log("status        :", httpResult.response.status);
console.log("duration      :", httpResult.response.timings.durationMs, "ms");
console.log("first byte    :", httpResult.response.timings.firstByteMs, "ms");
console.log("assertions ok :", httpResult.scripts?.passed);
console.log("replays       :", httpResult.replays);
console.log(
  "write-back    :",
  httpResult.patchedSpec ? "applied" : httpResult.writeBackSkippedReason,
);
console.log(
  "fragment      :",
  JSON.stringify(httpResult.responseFragment, null, 2),
);

let workingSpec = httpResult.patchedSpec ?? spec;

/* ------------------------------------------------------------------ */
/* 2. Server-Sent Events over the same runtime path                     */
/* ------------------------------------------------------------------ */

const sseResult = await pk.send({
  spec: workingSpec,
  target: { operationId: "streamChat" },
  values: {
    body: {
      model: "demo-model",
      stream: true,
      messages: [{ role: "user", content: "Summarize the release notes." }],
    },
  },
  serverUrl: BASE_URL,
  auth: { type: "bearer", token: TOKEN },
  maxEvents: 200,
  maxStreamMs: 60_000,
  scripts: {
    preRequest: {
      exec: "pm.request.headers.upsert({ key: 'Accept', value: 'text/event-stream' });",
    },
  },
  runner: {
    requester: { timings: true, verbose: true,  },
  },
  onEvent: (event) => {
    if (event.data.trim() === "[DONE]") {
      process.stdout.write("\n[stream complete]\n");
      return;
    }
    const delta = event.parsed?.choices?.[0]?.delta?.content;
    if (delta) process.stdout.write(String(delta));
  },
});

console.log("protocol      :", sseResult.protocol);
console.log("events        :", sseResult.response.events?.length);
console.log("truncated     :", sseResult.response.truncated === true);
console.log(
  "itemSchema    :",
  JSON.stringify(
    sseResult.responseFragment.content?.["text/event-stream"]?.itemSchema,
    null,
    2,
  ),
);

if (sseResult.patchedSpec) workingSpec = sseResult.patchedSpec;

/* ------------------------------------------------------------------ */
/* 3. WebSocket session                                                 */
/* ------------------------------------------------------------------ */

const wsResult = await pk.send({
  spec: workingSpec,
  target: { operationId: "joinRoom" },
  values: { path: { room: "general" }, query: { since: "0" } },
  serverUrl: BASE_URL,
  auth: { type: "bearer", token: TOKEN },
  websocket: {
    subprotocols: ["json.v1"],
    headers: { "X-Client": "protokit-demo" },
    send: [
      { type: "subscribe", channel: "messages" },
      { type: "ping", ts: Date.now() },
    ],
    sendDelayMs: 200,
    maxMessages: 25,
    maxSessionMs: 20_000,
    idleTimeoutMs: 8_000,
    keepAlive: { intervalMs: 10_000, payload: "ping" },
    closeCode: 1000,
    closeReason: "demo finished",
    rejectUnauthorized: true,
  },
  onOpen: (info) =>
    console.log("ws opened:", info.url, "protocol:", info.protocol),
  onEvent: (event) => {
    const arrow = event.direction === "out" ? "-->" : "<--";
    console.log(arrow, event.event, event.data.slice(0, 120));
  },
});

console.log("protocol      :", wsResult.protocol);
console.log(
  "handshake     :",
  wsResult.response.status,
  wsResult.response.statusText,
);
console.log("frames        :", wsResult.response.events?.length);
console.log("error         :", wsResult.error?.message ?? "none");

if (wsResult.patchedSpec) workingSpec = wsResult.patchedSpec;

/* ------------------------------------------------------------------ */
/* 4. Batch replay accumulating schemas across calls                    */
/* ------------------------------------------------------------------ */

const batch = await pk.sendMany(
  workingSpec,
  [
    { target: { operationId: "getUser" }, values: { path: { id: "1" } } },
    { target: { operationId: "getUser" }, values: { path: { id: "2" } } },
    {
      target: { operationId: "createOrder" },
      values: { body: { sku: "A-1", qty: 2 } },
      runner: { iterationCount: 1 },
    },
  ],
  {
    serverUrl: BASE_URL,
    auth: { type: "bearer", token: TOKEN },
    runner: { requester: { strictSSL: true, timings: true } },
  },
);

for (const entry of batch.results) {
  if ("error" in entry) {
    console.warn("failed:", JSON.stringify(entry.target), entry.error);
  } else {
    console.log(
      "ok:",
      entry.request.method,
      entry.response.status,
      entry.responseStatusCode,
    );
  }
}

await fs.writeFile(
  new URL("./openapi.patched.json", import.meta.url),
  JSON.stringify(batch.spec, null, 2),
  "utf8",
);
console.log("patched spec written to openapi.patched.json");

/* ------------------------------------------------------------------ */
/* 5. Export artifacts for the Postman app, without sending anything    */
/* ------------------------------------------------------------------ */

const exported = pk.toCollection(
  spec,
  { operationId: "getUser" },
  {
    serverUrl: BASE_URL,
    values: { path: { id: "{{userId}}" } },
    variables: { userId: "1024", token: TOKEN },
    auth: { type: "bearer", token: "{{token}}" },
    scripts: {
      test: { exec: "pm.test('ok', function () { pm.response.to.be.ok; });" },
    },
  },
);

console.log(
  "resolved adapter:",
  exported.protocol,
  "| streaming:",
  exported.streaming,
);
await fs.writeFile(
  new URL("./collection.json", import.meta.url),
  JSON.stringify(exported.collection, null, 2),
  "utf8",
);
await fs.writeFile(
  new URL("./environment.json", import.meta.url),
  JSON.stringify(exported.environment, null, 2),
  "utf8",
);
console.log("collection.json and environment.json written");
