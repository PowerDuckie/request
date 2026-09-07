import { defineConfig } from "tsup";

// One entry per package.json `exports` subpath, so `require("@powerduck/request/graphql")`
// and friends resolve to their own small bundle instead of pulling in the whole library
// (and, for grpc, its otherwise-optional peer dependencies).
export default defineConfig({
  entry: {
    index: "index.ts",
    "protocols/grpc/index": "protocols/grpc/index.ts",
    "protocols/graphql/index": "protocols/graphql/index.ts",
    "protocols/mcp/index": "protocols/mcp/index.ts",
  },
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  outDir: "dist",
  target: "node18",
  // Real runtime packages stay external; only this repo's own TS is bundled.
  external: [
    "postman-runtime",
    "postman-collection",
    "ws",
    "@grpc/grpc-js",
    "@grpc/proto-loader",
    "@grpc/reflection",
  ],
});
