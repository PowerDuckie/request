// Shared minimal JSON-RPC handler for the MCP fixtures. Implements just
// enough of the MCP protocol surface (initialize, tools/list, tools/call,
// resources/list, prompts/list, notifications) for the examples and tests.
const SERVER_INFO = { name: "echo-mcp", version: "1.0.0" };

const TOOLS = [
  {
    name: "echo",
    description: "Echo an object back with a server timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        n: { type: "integer" },
      },
      required: ["text"],
    },
  },
  {
    name: "add",
    description: "Add two numbers.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
    },
  },
];

export function createHandler() {
  let sessionId = null;

  return {
    handle(raw, respond) {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        respond(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "parse error" }, id: null }));
        return;
      }

      const { method, params = {}, id } = msg;

      if (method === "initialize") {
        sessionId = `sess_${Date.now().toString(36)}`;
        respond(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: params.protocolVersion ?? "2025-06-18",
              capabilities: {
                tools: { listChanged: false },
                resources: {},
                prompts: {},
              },
              serverInfo: SERVER_INFO,
            },
          }),
          sessionId,
        );
        return;
      }

      if (method === "notifications/initialized") {
        respond(null);
        return;
      }

      if (method === "tools/list") {
        respond(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: TOOLS } }));
        return;
      }

      if (method === "resources/list") {
        respond(JSON.stringify({ jsonrpc: "2.0", id, result: { resources: [] } }));
        return;
      }

      if (method === "prompts/list") {
        respond(JSON.stringify({ jsonrpc: "2.0", id, result: { prompts: [] } }));
        return;
      }

      if (method === "tools/call") {
        const tool = TOOLS.find((entry) => entry.name === params.name);
        const args = params.arguments ?? {};
        let text;
        if (!tool) {
          text = JSON.stringify({ error: `unknown tool ${params.name}` });
        } else if (tool.name === "echo") {
          text = JSON.stringify({ echo: args.text, n: args.n, at: Date.now() });
        } else {
          text = JSON.stringify({ sum: Number(args.a) + Number(args.b) });
        }
        respond(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text }],
              isError: false,
            },
          }),
        );
        return;
      }

      respond(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${method}` },
        }),
      );
    },
  };
}

export { SERVER_INFO };
