import test from "node:test";
import assert from "node:assert/strict";
import { discoverAndWriteGrpcOperations, wsManualSession, mcpManualSession } from "../src/index.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

test("grpc synthetic operations are written into OpenAPI", async () => {
  const spec = { openapi: "3.2.0", info: { title: "t", version: "1" }, paths: {} };
  const endpoint = { address: "127.0.0.1:50051", protoPaths: [join(here, "../examples/grpc/proto")] };
  const out = await discoverAndWriteGrpcOperations(spec, endpoint);
  const ops = Object.values(out.spec.paths).flatMap((p) => Object.values(p)).filter(Boolean);
  assert.ok(ops.some((op) => op.operationId === "grpc_demo_echo_Echo_Say"));
  assert.ok(ops.some((op) => op["x-protocol"] === "grpc"));
});

test("ws manual session exposes open/send/close methods", async () => {
  const s = wsManualSession({ url: "ws://127.0.0.1:65535" });
  assert.equal(typeof s.open, "function");
  assert.equal(typeof s.send, "function");
  assert.equal(typeof s.close, "function");
});

test("mcp manual session exposes list/call methods", async () => {
  const s = mcpManualSession({ endpoint: "http://127.0.0.1:1/mcp" });
  assert.equal(typeof s.open, "function");
  assert.equal(typeof s.listTools, "function");
  assert.equal(typeof s.listPrompts, "function");
  assert.equal(typeof s.listResources, "function");
  assert.equal(typeof s.listSources, "function");
  assert.equal(typeof s.callTool, "function");
});
