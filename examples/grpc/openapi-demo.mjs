
import fs from "node:fs/promises";
import { createDebugger, discoverAndWriteGrpcOperations, grpcManualSession } from "../../dist/index.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const endpoint = {
  address: process.env.ADDRESS ?? "127.0.0.1:50051",
  protoPaths: [join(here, "proto")],
};

let spec = { openapi: "3.2.0", info: { title: "gRPC OpenAPI Demo", version: "1.0.0" }, paths: {} };
const discovered = await discoverAndWriteGrpcOperations(spec, endpoint);
spec = discovered.spec;
await fs.writeFile(new URL("./openapi.generated.json", import.meta.url), JSON.stringify(spec, null, 2));
console.log("generated grpc operations:", discovered.discovery.services.flatMap(s=>s.methods.map(m=>`${s.name}/${m.name}`)));

const pk = createDebugger({ writeBack: { strategy: "merge", requirePassingTests: false }, response: { includeExamples: true } });

for (const op of [
  { operationId: "grpc_demo_echo_Echo_Say", body: { messages: [{ text: "hello", plain: "p" }] } },
  { operationId: "grpc_demo_echo_Echo_Countdown", body: { messages: [{ from: 3, interval_ms: 10 }], maxMessages: 10 } },
  { operationId: "grpc_demo_echo_Echo_Sum", body: { messages: [{ value: 1 }, { value: 2 }, { value: 3 }] } },
  { operationId: "grpc_demo_echo_Echo_Chat", body: { messages: [{ text: "one" }, { text: "two" }], maxSessionMs: 300 } },
]) {
  const r = await pk.send({ spec, target: { operationId: op.operationId }, values: { body: op.body } });
  console.log(op.operationId, r.response.status, JSON.stringify(r.response.body));
  if (r.patchedSpec) spec = r.patchedSpec;
}

const manual = await grpcManualSession({ ...endpoint, service: "demo.echo.Echo", method: "Chat" });
await manual.open();
await manual.send({ text: "manual-1" });
await manual.send({ text: "manual-2" });
await new Promise(r=>setTimeout(r, 100));
await manual.close();
await manual.waitForClose();
console.log("manual chat events:", manual.events);
await fs.writeFile(new URL("./openapi.patched.json", import.meta.url), JSON.stringify(spec, null, 2));
