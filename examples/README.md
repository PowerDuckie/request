# Examples

Each protocol has a `server.mjs` (a tiny standalone server to point the
library at) and a `demo.mjs` (drives it through `createDebugger()`).

## Setup

```bash
npm install       # installs postman-runtime/postman-collection/ws (library deps)
                   # + graphql, @modelcontextprotocol/sdk, zod (example-only deps)
npm run build      # tsup -> dist/index.cjs, dist/index.js, dist/*.d.ts
```

`grpc/*` additionally needs `@grpc/grpc-js` and `@grpc/proto-loader`
(optionally `@grpc/reflection`) — these are peer dependencies, install them
yourself if you want to run that example; every other adapter works without
them.

## Running

Each pair is two terminals: start the server, then run the demo against it.

```bash
# HTTP + SSE + WebSocket
node examples/http_ws/local-server.mjs &
BASE_URL=http://127.0.0.1:4000/v1 node examples/http_ws/demo.mjs

# GraphQL
node examples/graphql/server.mjs &
GRAPHQL_URL=http://127.0.0.1:4100/graphql node examples/graphql/demo.mjs

# MCP (Streamable HTTP)
node examples/mcp/server.mjs &
MCP_URL=http://127.0.0.1:4200/mcp node examples/mcp/demo.mjs

# gRPC
node examples/grpc/server.mjs &
ADDRESS=127.0.0.1:50051 node examples/grpc/client.mjs
```

Or via the npm scripts in `package.json` (`npm run dev:<protocol>:server`,
`npm run dev:<protocol>:demo`).

## What each demo does

- **http_ws**: one GET with scripts + full postman-runtime option
  passthrough, one SSE stream, one WebSocket session, a batch replay via
  `sendMany`, and a `toCollection` export — same as the original.
- **graphql**: `discoverAndWriteGraphQLSchema()` introspects the live
  schema and generates a runnable query/mutation document per field
  ("auto-fetch"), merges them into the OpenAPI document as synthetic
  `/graphql/...` paths ("upload"), then `send()`s a generated query, a
  generated mutation, and one hand-written query that overrides the
  generated document entirely.
- **mcp**: `discoverAndWriteMcpCapabilities()` runs the `initialize`
  handshake and lists every tool/resource/prompt the server exposes,
  samples arguments from each tool's input schema, merges them into the
  document as synthetic `/mcp/...` paths, then `send()`s two tool calls, a
  resource read, and a prompt fetch.
- **grpc**: unchanged from what was provided — discovery via proto
  directory and via server reflection, then unary/server-streaming/
  client-streaming/bidi calls and the documented failure paths.

Every demo writes its patched spec back to disk next to itself
(`openapi.patched.json`, `mcp.patched.json`, ...) so you can see the
response schemas/examples the write-back step inferred.
