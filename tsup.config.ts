import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/protocols/http/index.ts",
    "src/protocols/ws/index.ts",
    "src/openapi/index.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  target: "node18",
  platform: "node",
  // These carry native and dynamic requires that must not be bundled.
  external: ["postman-runtime", "postman-collection", "ws"],
});
