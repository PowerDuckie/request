// MCP Streamable-HTTP fixture server (request/response flavor).
// Speaks just enough JSON-RPC for initialize / tools / resources / prompts.
import http from "node:http";
import { createHandler } from "./jsonrpc.mjs";

const handler = createHandler();

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32600, message: "POST only" }, id: null }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    let responded = false;
    const respond = (payload, sessionId) => {
      if (responded) return;
      responded = true;
      if (payload === null) {
        res.writeHead(202, { "content-type": "application/json" });
        res.end();
        return;
      }
      const headers = { "content-type": "application/json" };
      if (sessionId) headers["mcp-session-id"] = sessionId;
      res.writeHead(200, headers);
      res.end(payload);
    };
    handler.handle(body, respond);
  });
});

const port = Number(process.env.PORT ?? 4400);
server.listen(port, "127.0.0.1", () => {
  console.log(`mcp http server listening on http://127.0.0.1:${port}`);
});
