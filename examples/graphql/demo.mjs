import fs from "node:fs/promises";
import {
  createDebugger,
  discoverAndWriteGraphQLSchema,
} from "../../dist/index.js";

const ENDPOINT = process.env.GRAPHQL_URL ?? "http://127.0.0.1:4100/graphql";

const pk = createDebugger({
  writeBack: { strategy: "merge", requirePassingTests: false },
  response: { includeExamples: true },
});

/* ------------------------------------------------------------------ */
/* 1. Auto-fetch: introspect the live schema + generate runnable docs   */
/*    for every query/mutation/subscription field ("自动获取query").    */
/* ------------------------------------------------------------------ */

let spec = {
  openapi: "3.2.0",
  info: { title: "GraphQL Demo", version: "1.0.0" },
  servers: [{ url: ENDPOINT }],
  paths: {},
};

const discovered = await discoverAndWriteGraphQLSchema(spec, ENDPOINT);
spec = discovered.spec;

console.log(spec, `discovered ${discovered.operations.length} operation(s):`);
for (const op of discovered.operations) {
  console.log(`  ${op.operationType.padEnd(8)} ${op.fieldName}`);
}
for (const w of discovered.warnings) console.log(`  ! ${w}`);

/* ------------------------------------------------------------------ */
/* 2. Upload confirmation: the generated operations are now ordinary    */
/*    OpenAPI paths, addressable by operationId like any REST call.     */
/* ------------------------------------------------------------------ */

await fs.writeFile(
  new URL("./openapi.generated.json", import.meta.url),
  JSON.stringify(spec, null, 2),
  "utf8",
);
console.log("generated schema written to openapi.generated.json");

/* ------------------------------------------------------------------ */
/* 3. Send a generated query, sampled variables and all                 */
/* ------------------------------------------------------------------ */

const userResult = await pk.send({
  spec,
  target: { operationId: "graphql_query_user" },
  graphql: { variables: { id: "1" } },
});

console.log("\nquery user(id: 1)");
console.log("status   :", userResult.response.status);
console.log("data     :", JSON.stringify(userResult.response.body?.data));
console.log("errors   :", userResult.response.body?.errors ?? "none");

if (userResult.patchedSpec) spec = userResult.patchedSpec;

/* ------------------------------------------------------------------ */
/* 4. Send a mutation with an explicit query override                   */
/* ------------------------------------------------------------------ */

const createPostResult = await pk.send({
  spec,
  target: { operationId: "graphql_mutation_createPost" },
  graphql: {
    variables: {
      input: {
        title: "Shipped it",
        body: "The MCP + GraphQL adapters are in.",
        authorId: "2",
      },
    },
  },
});

console.log("\nmutation createPost(...)");
console.log("status   :", createPostResult.response.status);
console.log("data     :", JSON.stringify(createPostResult.response.body?.data));
console.log("errors   :", createPostResult.response.body?.errors ?? "none");

if (createPostResult.patchedSpec) spec = createPostResult.patchedSpec;

/* ------------------------------------------------------------------ */
/* 5. A hand-written query, bypassing discovery entirely                */
/* ------------------------------------------------------------------ */

const listResult = await pk.send({
  spec,
  target: { operationId: "graphql_query_users" },
  graphql: {
    query: `query Users($role: Role) { users(role: $role) { id name role } }`,
    variables: { role: "MEMBER" },
  },
});

console.log("\nquery users(role: MEMBER) [hand-written override]");
console.log("status   :", listResult.response.status);
console.log("data     :", JSON.stringify(listResult.response.body?.data));

await fs.writeFile(
  new URL("./openapi.patched.json", import.meta.url),
  JSON.stringify(spec, null, 2),
  "utf8",
);
console.log(
  "\npatched spec (with response examples) written to openapi.patched.json",
);
