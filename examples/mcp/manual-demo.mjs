
import { mcpManualSession } from "../../dist/index.js";
const endpoint = process.env.MCP_URL ?? "http://127.0.0.1:4200/mcp";
const s = mcpManualSession({ endpoint });
await s.open();
await s.send({ method: "tools/list", params: {} });
await s.send({ method: "prompts/list", params: {} });
await s.send({ method: "resources/list", params: {} });
await s.send({ method: "tools/call", params: { name: "echo", arguments: { text: "manual mcp" } } });
await s.close();
console.log(JSON.stringify(s.events, null, 2));
