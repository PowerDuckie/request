// MCP stdio fixture server: newline-delimited JSON-RPC over stdin/stdout.
import readline from "node:readline";
import { createHandler } from "./jsonrpc.mjs";

const handler = createHandler();
const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  if (!line.trim()) return;
  handler.handle(line, (payload, sessionId) => {
    if (payload === null) return;
    if (sessionId) process.stderr.write(`mcp-session-id: ${sessionId}\n`);
    process.stdout.write(`${payload}\n`);
  });
});

process.stderr.write("mcp stdio server ready\n");
