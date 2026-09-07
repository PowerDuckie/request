import fs from "node:fs/promises";
import {
  createDebugger,
  discoverAndWriteMcpCapabilities,
} from "../../dist/index.js";

const ENDPOINT = process.env.MCP_URL ?? "http://127.0.0.1:4200/mcp";

const pk = createDebugger({
  writeBack: { strategy: "merge", requirePassingTests: false },
  response: { includeExamples: true },
});

/* ------------------------------------------------------------------ */
/* 1. Auto-fetch: initialize + list every tool/resource/prompt the      */
/*    server exposes, sampling arguments for each ("自动获取").          */
/* ------------------------------------------------------------------ */

let spec = {
  openapi: "3.2.0",
  info: { title: "MCP Demo", version: "1.0.0" },
  servers: [{ url: ENDPOINT }],
  paths: {},
};

const discovered = await discoverAndWriteMcpCapabilities(spec, ENDPOINT);
spec = discovered.spec;

console.log(`server: ${discovered.capabilities.length ? "reachable" : "no capabilities found"}`);
console.log(`discovered ${discovered.capabilities.length} capability(ies):`);
for (const cap of discovered.capabilities) {
  console.log(`  ${cap.kind.padEnd(9)} ${cap.name}`);
}
for (const w of discovered.warnings) console.log(`  ! ${w}`);

/* ------------------------------------------------------------------ */
/* 2. Upload confirmation                                               */
/* ------------------------------------------------------------------ */

await fs.writeFile(
  new URL("./mcp.generated.json", import.meta.url),
  JSON.stringify(spec, null, 2),
  "utf8",
);
console.log("generated capability spec written to mcp.generated.json");

/* ------------------------------------------------------------------ */
/* 3. Call a tool, overriding the sampled arguments                     */
/* ------------------------------------------------------------------ */

const echoResult = await pk.send({
  spec,
  target: { operationId: "mcp_tool_echo" },
  mcp: { arguments: { text: "hello from the mcp adapter" } },
});

console.log("\ntools/call echo");
console.log("status  :", echoResult.response.status);
console.log("result  :", JSON.stringify(echoResult.response.body));
console.log("error   :", echoResult.error?.message ?? "none");

if (echoResult.patchedSpec) spec = echoResult.patchedSpec;

/* ------------------------------------------------------------------ */
/* 4. Call another tool with numeric arguments                          */
/* ------------------------------------------------------------------ */

const addResult = await pk.send({
  spec,
  target: { operationId: "mcp_tool_add" },
  mcp: { arguments: { a: 2, b: 40 } },
});

console.log("\ntools/call add");
console.log("status  :", addResult.response.status);
console.log("result  :", JSON.stringify(addResult.response.body));

if (addResult.patchedSpec) spec = addResult.patchedSpec;

/* ------------------------------------------------------------------ */
/* 5. Read a resource (uri comes from the discovered x-mcp extension)   */
/* ------------------------------------------------------------------ */

const resourceResult = await pk.send({
  spec,
  target: { operationId: "mcp_resource_config" },
});

console.log("\nresources/read config://app");
console.log("status  :", resourceResult.response.status);
console.log("result  :", JSON.stringify(resourceResult.response.body));

if (resourceResult.patchedSpec) spec = resourceResult.patchedSpec;

/* ------------------------------------------------------------------ */
/* 6. Get a prompt                                                      */
/* ------------------------------------------------------------------ */

const promptResult = await pk.send({
  spec,
  target: { operationId: "mcp_prompt_summarize" },
  mcp: { arguments: { text: "ProtoKit now speaks GraphQL and MCP." } },
});

console.log("\nprompts/get summarize");
console.log("status  :", promptResult.response.status);
console.log("result  :", JSON.stringify(promptResult.response.body));

if (promptResult.patchedSpec) spec = promptResult.patchedSpec;

await fs.writeFile(
  new URL("./mcp.patched.json", import.meta.url),
  JSON.stringify(spec, null, 2),
  "utf8",
);
console.log("\npatched spec (with response examples) written to mcp.patched.json");
