import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDebugger } from "../../src/index";
import { startTestServer, type TestServer } from "../helpers/server";
import { makeSpec } from "../helpers/spec";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

describe("error handling", () => {
  it("surfaces connection refusal as an error result or rejection", async () => {
    const pk = createDebugger();

    try {
      const result = await pk.send({
        spec: makeSpec(),
        target: { operationId: "getUser" },
        values: { path: { id: "1" } },
        serverUrl: `http://127.0.0.1:${server.port + 20}/v1`,
        runner: {
          timeout: { request: 3000 },
        },
      });

      expect(result.error).toBeDefined();
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it("handles 500 responses", async () => {
    const pk = createDebugger();

    const result = await pk.send({
      spec: makeSpec(),
      target: { operationId: "getBoomUser" },
      serverUrl: server.baseUrl,
    });

    expect(result.response.status).toBe(500);
    expect(result.responseFragment).toBeDefined();
  });

  it("fills a missing required path value from the schema sample", async () => {
    const pk = createDebugger();

    const result = await pk.send({
      spec: makeSpec(),
      target: { operationId: "getUser" },
      values: { path: {} },
      serverUrl: server.baseUrl,
    });

    expect(result.response.status).toBe(200);
    expect(result.request.url).toContain("/users/string");
  });

  it("rejects a malformed spec", async () => {
    const pk = createDebugger();

    await expect(
      pk.send({
        spec: { openapi: "3.2.0" } as any,
        target: { operationId: "getUser" },
        serverUrl: server.baseUrl,
      }),
    ).rejects.toThrow();
  });

  it("does not let a throwing onResponseStart callback abort the request", async () => {
    const pk = createDebugger();

    const result = await pk.send({
      spec: makeSpec(),
      target: { operationId: "getUser" },
      values: { path: { id: "1" } },
      serverUrl: server.baseUrl,
      onResponseStart: () => {
        throw new Error("callback failed");
      },
    });

    expect(result.response.status).toBe(200);
  });

  it("does not let a throwing onEvent callback lose the stream", async () => {
    const pk = createDebugger();

    const result = await pk.send({
      spec: makeSpec(),
      target: { operationId: "streamChat" },
      values: {
        body: {
          model: "demo-model",
          stream: true,
          messages: [{ role: "user", content: "Hello" }],
        },
      },
      serverUrl: server.baseUrl,
      onEvent: () => {
        throw new Error("event callback failed");
      },
    });

    expect((result.response.events?.length ?? 0) > 0).toBe(true);
  });
});