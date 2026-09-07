import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  discover,
  describeMethod,
  grpcCall,
  listServices,
  buildCredentialsAsync,
} from "@powerduck/request/grpc";

const here = dirname(fileURLToPath(import.meta.url));
const ADDRESS = process.env.ADDRESS ?? "127.0.0.1:50051";

/** Source A: local proto tree. Pass the directory; it is walked and merged. */
const viaProto = {
  address: ADDRESS,
  protoPaths: [join(here, "proto")],
  service: "demo.echo.Echo",
};

/** Source B: server reflection. No local files at all. */
const viaReflection = {
  address: ADDRESS,
  reflection: true,
  service: "demo.echo.Echo",
};

/* ------------------------------------------------------------------ */

const hr = (title) =>
  console.log(`\n${"─".repeat(66)}\n${title}\n${"─".repeat(66)}`);

const report = (label, r) => {
  const flags = [
    `kind=${r.kind}`,
    `status=${r.status?.codeName ?? "?"}(${r.status?.code ?? "?"})`,
    `truncated=${r.truncated}${r.truncatedReason ? `:${r.truncatedReason}` : ""}`,
    `${r.durationMs}ms`,
  ].join("  ");
  console.log(`\n▸ ${label}\n  ${flags}`);
  if (r.status?.details) console.log(`  details   : ${r.status.details}`);
  if (r.error) console.log(`  error     : ${r.error}`);
  console.log(`  inbound(${r.messages.length}): ${JSON.stringify(r.messages)}`);
  console.log(
    `  events    : ${r.events.map((e) => `${e.seq}${e.direction[0]}`).join(" ")}`,
  );
  for (const w of r.warnings) console.log(`  ! ${w}`);
};

const attempt = async (label, fn) => {
  try {
    return await fn();
  } catch (e) {
    console.log(`\n▸ ${label}\n  threw: ${e.message}`);
    return undefined;
  }
};

/* ================================================================== *
 * 1. Discovery — the "method list" half of the workflow
 * ================================================================== */

hr("1. DISCOVERY");

for (const [label, endpoint] of [
  ["proto directory", viaProto],
  ["server reflection", viaReflection],
]) {
  await attempt(`discover via ${label}`, async () => {
    const result = await discover(endpoint);
    console.log(`\n▸ discover via ${label}  (source=${result.source})`);
    if (result.files) console.log(`  files: ${result.files.length}`);
    for (const n of result.notes) console.log(`  ! ${n}`);
    for (const svc of result.services) {
      console.log(`  ${svc.name}`);
      for (const m of svc.methods) {
        console.log(
          `    ${m.name.padEnd(12)} ${m.kind.padEnd(18)} ${m.inputType} -> ${m.outputType}`,
        );
      }
    }
  });
}

/* ================================================================== *
 * 2. Request template — what the user may actually edit
 * ================================================================== */

hr("2. REQUEST TEMPLATE (structure is read-only; values are editable)");

await attempt("describeMethod Say", async () => {
  const detail = await describeMethod(viaProto, "demo.echo.Echo", "Say", {
    includeResponse: false,
  });
  console.log(`\n▸ ${detail.service}/${detail.name}  kind=${detail.kind}`);
  console.log(
    `  example:\n${JSON.stringify(detail.request?.example, null, 2).replace(/^/gm, "    ")}`,
  );
  for (const o of detail.request?.oneofs ?? []) {
    console.log(
      `  oneof "${o.oneof}" at "${o.at || "(root)"}": [${o.branches.join(" | ")}] chosen=${o.chosen}`,
    );
  }
  for (const e of detail.request?.enums ?? []) {
    console.log(`  enum  ${e.at}: ${e.values.join(" | ")}`);
  }
  for (const c of detail.request?.collections ?? []) {
    console.log(`  ${c.kind.padEnd(8)} ${c.at} of ${c.of}`);
  }
  for (const p of detail.request?.presence ?? []) {
    console.log(`  presence ${p.at} (${p.reason})`);
  }
  for (const w of detail.request?.warnings ?? []) console.log(`  ! ${w}`);
});

await attempt("listServices via reflection", async () => {
  const services = await listServices({
    address: ADDRESS,
    credentials: await buildCredentialsAsync({}),
    timeoutMs: 3000,
  });
  console.log(`\n▸ reflection list_services: ${services.join(", ")}`);
});

/* ================================================================== *
 * 3. Mode 1 — unary
 * ================================================================== */

hr("3. UNARY");

report(
  "unary Say (oneof: plain branch, nickname omitted)",
  await grpcCall(
    { ...viaProto, method: "Say" },
    {
      messages: [
        {
          text: "hello",
          plain: "p",
          meta: { trace_id: "cli-1" },
          tags: ["a"],
          severity: "INFO",
        },
      ],
    },
  ),
);

report(
  "unary Say (oneof: decorated branch, nickname set to empty string)",
  await grpcCall(
    { ...viaProto, method: "Say" },
    {
      messages: [
        {
          text: "core",
          decorated: { prefix: "<<", suffix: ">>" },
          nickname: "",
        },
      ],
    },
  ),
);

report(
  "unary Say (extra messages ignored -> warning)",
  await grpcCall(
    { ...viaProto, method: "Say" },
    {
      messages: [{ text: "first" }, { text: "second" }, { text: "third" }],
    },
  ),
);

report(
  "unary Boom (non-OK status must survive)",
  await grpcCall(
    { ...viaProto, method: "Boom" },
    { messages: [{ text: "x" }] },
  ),
);

report(
  "unary Say with metadata + deadline",
  await grpcCall(
    {
      ...viaProto,
      method: "Say",
      metadata: { "x-trace": "abc", "x-multi": ["1", "2"] },
      deadlineMs: 2000,
    },
    { messages: [{ text: "with headers" }] },
  ),
);

/* ================================================================== *
 * 4. Mode 2 — server streaming, each termination condition
 * ================================================================== */

hr("4. SERVER STREAMING");

report(
  "Countdown runs to completion",
  await grpcCall(
    { ...viaProto, method: "Countdown" },
    {
      messages: [{ from: 4, interval_ms: 40 }],
      onEvent: (e) => {
        if (e.direction === "inbound")
          process.stdout.write(`  <- ${e.payload.value}\n`);
      },
    },
  ),
);

report(
  "Countdown stopped by maxMessages=3",
  await grpcCall(
    { ...viaProto, method: "Countdown" },
    {
      messages: [{ from: 100, interval_ms: 20 }],
      maxMessages: 3,
    },
  ),
);

report(
  "Countdown stopped by idleTimeoutMs=60 (server interval 250)",
  await grpcCall(
    { ...viaProto, method: "Countdown" },
    {
      messages: [{ from: 100, interval_ms: 250 }],
      idleTimeoutMs: 60,
    },
  ),
);

report(
  "Countdown stopped by maxSessionMs=150",
  await grpcCall(
    { ...viaProto, method: "Countdown" },
    {
      messages: [{ from: 100, interval_ms: 30 }],
      maxSessionMs: 150,
    },
  ),
);

report(
  "Countdown stopped by deadlineMs=150 (server-side deadline, not truncation)",
  await grpcCall(
    { ...viaProto, method: "Countdown", deadlineMs: 150 },
    {
      messages: [{ from: 100, interval_ms: 30 }],
    },
  ),
);

{
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 90);
  report(
    "Countdown aborted via AbortSignal",
    await grpcCall(
      { ...viaProto, method: "Countdown" },
      {
        messages: [{ from: 100, interval_ms: 30 }],
        signal: controller.signal,
      },
    ),
  );
}

report(
  "Countdown with a throwing onEvent (must not take down the call)",
  await grpcCall(
    { ...viaProto, method: "Countdown" },
    {
      messages: [{ from: 3, interval_ms: 30 }],
      onEvent: () => {
        throw new Error("callback blew up");
      },
    },
  ),
);

/* ================================================================== *
 * 5. Mode 3 — client streaming
 * ================================================================== */

hr("5. CLIENT STREAMING");

report(
  "Sum of 1+2+39",
  await grpcCall(
    { ...viaProto, method: "Sum" },
    {
      messages: [{ value: 1 }, { value: 2 }, { value: 39 }],
    },
  ),
);

report(
  "Sum paced at 40ms per message",
  await grpcCall(
    { ...viaProto, method: "Sum" },
    {
      messages: [{ value: 10 }, { value: 20 }, { value: 30 }],
      sendIntervalMs: 40,
    },
  ),
);

report(
  "Sum with no messages (immediate half-close)",
  await grpcCall({ ...viaProto, method: "Sum" }, { messages: [] }),
);

report(
  "Sum aborted mid-send (results reflect how far it got)",
  await (async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 70);
    return grpcCall(
      { ...viaProto, method: "Sum" },
      {
        messages: [
          { value: 1 },
          { value: 2 },
          { value: 3 },
          { value: 4 },
          { value: 5 },
        ],
        sendIntervalMs: 50,
        signal: controller.signal,
      },
    );
  })(),
);

/* ================================================================== *
 * 6. Mode 4 — bidi streaming
 * ================================================================== */

hr("6. BIDI STREAMING");

report(
  "Chat, half-close after writes (server ends the stream)",
  await grpcCall(
    { ...viaProto, method: "Chat" },
    {
      messages: [
        { from: "cli", text: "one" },
        { from: "cli", text: "two" },
      ],
      sendIntervalMs: 30,
    },
  ),
);

report(
  "Chat, keepWriteOpen bounded by maxSessionMs=250",
  await grpcCall(
    { ...viaProto, method: "Chat" },
    {
      messages: [{ from: "cli", text: "ping" }],
      keepWriteOpen: true,
      maxSessionMs: 250,
    },
  ),
);

report(
  "Chat, keepWriteOpen bounded by idleTimeoutMs=120",
  await grpcCall(
    { ...viaProto, method: "Chat" },
    {
      messages: [{ from: "cli", text: "ping" }],
      keepWriteOpen: true,
      idleTimeoutMs: 120,
    },
  ),
);

report(
  "Chat, keepWriteOpen with maxMessages=2",
  await grpcCall(
    { ...viaProto, method: "Chat" },
    {
      messages: [
        { from: "cli", text: "a" },
        { from: "cli", text: "b" },
        { from: "cli", text: "c" },
      ],
      keepWriteOpen: true,
      maxMessages: 2,
    },
  ),
);

report(
  "Chat, keepWriteOpen with NO limit (expect the unbounded warning)",
  await grpcCall(
    { ...viaProto, method: "Chat", deadlineMs: 300 },
    {
      messages: [{ from: "cli", text: "bounded only by deadline" }],
      keepWriteOpen: true,
    },
  ),
);

/* ================================================================== *
 * 7. Same calls, descriptor obtained via reflection
 * ================================================================== */

hr("7. REFLECTION AS THE DESCRIPTOR SOURCE");

for (const [label, method, options] of [
  ["unary Say", "Say", { messages: [{ text: "hello from reflection" }] }],
  [
    "server streaming Countdown",
    "Countdown",
    { messages: [{ from: 3, interval_ms: 30 }] },
  ],
  ["client streaming Sum", "Sum", { messages: [{ value: 7 }, { value: 8 }] }],
  [
    "bidi Chat",
    "Chat",
    { messages: [{ from: "cli", text: "hi" }], sendIntervalMs: 20 },
  ],
]) {
  await attempt(`${label} via reflection`, async () => {
    report(
      `${label} via reflection`,
      await grpcCall({ ...viaReflection, method }, options),
    );
  });
}

/* ================================================================== *
 * 8. Failure paths
 * ================================================================== */

hr("8. FAILURE PATHS");

await attempt("unknown service", () =>
  grpcCall(
    { ...viaProto, service: "demo.echo.Nope", method: "Say" },
    { messages: [{}] },
  ),
);

await attempt("unknown method", () =>
  grpcCall({ ...viaProto, method: "Nope" }, { messages: [{}] }),
);

await attempt("missing proto path", () =>
  grpcCall(
    {
      address: ADDRESS,
      protoPaths: [join(here, "nope")],
      service: "demo.echo.Echo",
      method: "Say",
    },
    { messages: [{}] },
  ),
);

await attempt("neither protoPaths nor reflection", () =>
  grpcCall(
    { address: ADDRESS, service: "demo.echo.Echo", method: "Say" },
    { messages: [{}] },
  ),
);

report(
  "connection refused",
  await grpcCall(
    { ...viaProto, address: "127.0.0.1:1", method: "Say" },
    { messages: [{ text: "x" }] },
  ),
);

await attempt("reflection against a server without it", () =>
  grpcCall(
    {
      address: "127.0.0.1:1",
      reflection: true,
      service: "demo.echo.Echo",
      method: "Say",
    },
    { messages: [{}] },
  ),
);

console.log("\ndone\n");
