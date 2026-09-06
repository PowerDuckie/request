import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDebugger } from "../../src/index";
import { startTestServer } from "../helpers/server";
import { makeSpec } from "../helpers/spec";

describe("integration/send", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe("send()", () => {
    it("runs an HTTP request, scripts, and write-back together", async () => {
      const pk = createDebugger();

      const result = await pk.send({
        spec: makeSpec(),
        target: { operationId: "getUser" },
        values: { path: { id: "7" } },
        serverUrl: server.baseUrl,
        scripts: {
          preRequest: {
            id: "pre",
            exec: [
              "pm.environment.set('fromPre', 'yes');",
              "console.log('pre ran');",
            ],
          },
          test: {
            id: "test",
            exec: [
              "pm.test('status is 200', function () {",
              "  pm.response.to.have.status(200);",
              "});",
            ],
          },
        },
      });

      expect(result.protocol).toBe("http");
      expect(result.response.status).toBe(200);
      expect(result.scripts?.passed).toBe(true);
      expect(
        result.scripts?.assertions.some((a) => a.name === "status is 200"),
      ).toBe(true);
      expect(result.responseFragment.content).toHaveProperty(
        "application/json",
      );
      expect(result.patchedSpec).toBeDefined();
    });

    it("supports batch accumulation through sendMany()", async () => {
      const pk = createDebugger();

      const batch = await pk.sendMany(
        makeSpec(),
        [
          {
            target: { operationId: "getUser" },
            values: { path: { id: "7" } },
          },
          {
            target: { operationId: "getUser" },
            values: { path: { id: "9" } },
          },
        ],
        { serverUrl: server.baseUrl },
      );

      expect(batch.results).toHaveLength(2);
      expect("spec" in batch).toBe(true);
      expect(batch.spec).toBeDefined();
    });
  });

  describe("SSE", () => {
    it("streams events and converts them into an itemSchema response fragment", async () => {
      const pk = createDebugger();
      const seen: string[] = [];

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
        onEvent: (event) => {
          seen.push(event.data);
        },
      });

      expect(result.protocol).toBe("sse");
      expect(result.response.status).toBe(200);
      expect(result.response.events?.length).toBe(7);
      expect(seen.at(-1)).toBe("[DONE]");
      expect(result.response.truncated).toBeUndefined();

      const media = result.responseFragment.content["text/event-stream"];
      expect(media).toBeDefined();
      expect(media.itemSchema).toBeDefined();
      expect(media["x-protokit-sample-count"]).toBeGreaterThan(0);
      expect(media["x-protokit-truncated"]).toBeUndefined();
    });

    it.skip("stops at maxEvents and flags truncation", async () => {
      const pk = createDebugger();

      const result = await pk.send({
        spec: makeSpec(),
        target: { operationId: "endlessChat" },
        serverUrl: server.baseUrl,
        maxEvents: 3,
      });

      expect(result.protocol).toBe("sse");
      expect(result.response.status).toBe(200);
      expect(result.response.events?.length).toBe(3);
      expect(result.response.truncated).toBe(true);
      expect(
        result.responseFragment.content["text/event-stream"][
          "x-protokit-truncated"
        ],
      ).toBe(true);
    }, 15000);

    it.skip("stops at maxStreamMs without hanging", async () => {
      const pk = createDebugger();
      const started = Date.now();

      const result = await pk.send({
        spec: makeSpec(),
        target: { operationId: "endlessChat" },
        serverUrl: server.baseUrl,
        maxStreamMs: 200,
      });

      const elapsed = Date.now() - started;

      expect(result.protocol).toBe("sse");
      expect(result.response.status).toBe(200);
      expect(result.response.truncated).toBe(true);
      expect(result.response.events?.length ?? 0).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(5000);
    }, 15000);
  });

  describe("WebSocket", () => {
    it("executes a websocket operation and captures inbound events", async () => {
      const pk = createDebugger();
      const directions: string[] = [];

      const result = await pk.send({
        spec: makeSpec(),
        target: { operationId: "joinRoom" },
        values: {
          path: { room: "general" },
          query: { since: "0" },
        },
        serverUrl: server.baseUrl,
        websocket: {
          subprotocols: ["json.v1"],
          send: [{ type: "subscribe", channel: "messages" }],
          sendDelayMs: 20,
          maxMessages: 5,
          maxSessionMs: 10_000,
          idleTimeoutMs: 3_000,
        },
        onEvent: (e) => {
          if (e.direction) directions.push(e.direction);
        },
      });

      expect(result.protocol).toBe("websocket");
      expect(result.response.events?.length).toBeGreaterThan(0);
      expect(directions).toContain("in");
    });
  });

  describe("toCollection()", () => {
    it("exports a regular HTTP operation", () => {
      const pk = createDebugger();

      const exported = pk.toCollection(
        makeSpec(),
        { operationId: "getUser" },
        { serverUrl: server.baseUrl },
      );

      expect(exported.protocol).toBe("http");
      expect(exported.streaming).toBe(false);
      expect(exported.collection).toBeDefined();
      expect(exported.environment).toBeDefined();
    });

    it("flags a streaming operation as such", () => {
      const pk = createDebugger();

      const exported = pk.toCollection(
        makeSpec(),
        { operationId: "streamChat" },
        { serverUrl: server.baseUrl },
      );

      expect(exported.protocol).toBe("http");
      expect(exported.streaming).toBe(true);
      expect(exported.collection).toBeDefined();
      expect(exported.environment).toBeDefined();
    });

    it("exports a websocket operation with the websocket adapter", () => {
      const pk = createDebugger();

      const exported = pk.toCollection(
        makeSpec(),
        { operationId: "joinRoom" },
        { serverUrl: server.baseUrl },
      );

      expect(exported.protocol).toBe("websocket");
      expect(exported.environment).toBeDefined();
    });
  });
});
