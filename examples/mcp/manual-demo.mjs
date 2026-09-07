import { mcpManualSession } from "../../dist/index.js";

const endpoint = process.env.MCP_ENDPOINT ?? "http://127.0.0.1:4200/mcp";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());

const session = mcpManualSession({
  endpoint,
  clientInfo: { name: "manual-demo", version: "1.0.0" },
  timeoutMs: 15_000,
  signal: controller.signal,
});

/** Servers legitimately lack prompts/resources; report instead of crashing. */
async function attempt(label, fn) {
  try {
    const value = await fn();
    console.log(`${label}:`, JSON.stringify(value, null, 2));
    return value;
  } catch (e) {
    console.log(`${label}: unavailable — ${e?.message ?? e}`);
    return undefined;
  }
}

try {
  await session.open();
  console.log("opened", session.sessionId);
  console.log(
    "server",
    JSON.stringify(session.serverInfo),
    session.protocolVersion,
  );

  const tools = await attempt("tools", () =>
    session.listTools().then((r) => r.items),
  );
  await attempt("prompts", () => session.listPrompts().then((r) => r.items));
  await attempt("sources", () => session.listSources().then((r) => r.items));

  if (tools?.some((t) => t.name === "echo")) {
    await attempt("echo", () => session.callTool("echo", { text: "hello" }));
  } else {
    console.log('echo: server exposes no "echo" tool, skipping call');
  }
} catch (e) {
  console.error("fatal:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await session.close();
  console.log("state:", session.state);
  console.log("events:", JSON.stringify(session.events, null, 2));
}
