import { mcpManualSession } from "../../dist/index.js";

const endpoint = process.env.MCP_ENDPOINT ?? "http://127.0.0.1:8788/mcp";
const session = mcpManualSession({
  endpoint,
  clientInfo: { name: "manual-demo", version: "1.0.0" },
});

await session.open();
console.log("opened", session.sessionId);

console.log("tools:");
console.log(JSON.stringify(await session.listTools(), null, 2));

console.log("prompts:");
console.log(JSON.stringify(await session.listPrompts(), null, 2));

console.log("resources/sources:");
console.log(JSON.stringify(await session.listSources(), null, 2));

console.log("tool call:");
console.log(JSON.stringify(await session.callTool("echo", { text: "hello" }), null, 2));

await session.close();
console.log("events:");
console.log(JSON.stringify(session.events, null, 2));
