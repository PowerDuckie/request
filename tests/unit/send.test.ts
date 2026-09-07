import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDebugger } from "../../src/index";
import { startTestServer } from "../helpers/server";
import { makeSpec } from "../helpers/spec";

describe("send", () => {
  const pk = createDebugger();
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe("HTTP", () => {
    it("sends a request and infers a response fragment", async () => {
      const result = await pk.send({
        spec: makeSpec(),
        target: { operationId: "getUser" },
        values: { path: { id: "7" } },
        serverUrl: server.baseUrl,
      });

      expect(result.protocol).toBe("http");
      expect(result.response.status).toBe(200);
      expect(result.response.body).toBeDefined();
      expect(result.response.text).toEqual(expect.any(String));

      expect(result.responseFragment).toBeDefined();
      expect(result.responseFragment.content).toHaveProperty(
        "application/json",
      );

      expect(
        Object.keys(result.responseFragment.headers ?? {}).map((k) =>
          k.toLowerCase(),
        ),
      ).toContain("x-ratelimit-remaining");

      expect(result.responseStatusCode).toBe("200");
      expect(result.patchedSpec).toBeDefined();
      expect(result.writeBackSkippedReason).toBeUndefined();
    });

    it("rejects when the target operation does not exist", async () => {
      const failing = createDebugger();

      await expect(
        failing.send({
          spec: makeSpec(),
          target: { operationId: "missingOperation" },
          serverUrl: server.baseUrl,
        }),
      ).rejects.toThrow();
    });

    it("skips write-back when disabled", async () => {
      const result = await pk.send({
        spec: makeSpec(),
        target: { operationId: "getUser" },
        values: { path: { id: "7" } },
        serverUrl: server.baseUrl,
        writeBack: false,
      });

      expect(result.patchedSpec).toBeUndefined();
      expect(result.writeBackSkippedReason).toBe(
        "disabled by options.writeBack",
      );
    });

    it("skips write-back when a test script fails", async () => {
      const result = await pk.send({
        spec: makeSpec(),
        target: { operationId: "getUser" },
        values: { path: { id: "7" } },
        serverUrl: server.baseUrl,
        scripts: {
          test: {
            id: "failing-test",
            exec: [
              "pm.test('forced failure', function () {",
              "  pm.expect(1).to.eql(2);",
              "});",
            ],
          },
        },
      });

      expect(result.scripts?.passed).toBe(false);
      expect(result.patchedSpec).toBeUndefined();
      expect(result.writeBackSkippedReason).toBe(
        "one or more assertions failed",
      );
    });
  });

  describe("SSE", () => {
    it("streams events and records them", async () => {
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
      expect(result.response.contentType).toMatch(/text\/event-stream/i);
      expect(result.response.events?.length).toBe(7);
      expect(seen.at(-1)).toBe("[DONE]");
      expect(result.response.truncated).toBeUndefined();

      expect(result.responseFragment).toBeDefined();
      expect(result.responseFragment.content).toHaveProperty(
        "text/event-stream",
      );

      const media = result.responseFragment.content["text/event-stream"];
      expect(media.itemSchema).toBeDefined();
      expect(media["x-protokit-sample-count"]).toBeGreaterThan(0);
      expect(media["x-protokit-truncated"]).toBeUndefined();
    });

    it("stops at maxEvents and marks the response as truncated", async () => {
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

    it("stops at maxStreamMs without hanging", async () => {
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
      expect(result.response.events?.length ?? 0).toBeGreaterThan(0);
      expect(result.response.truncated).toBe(true);
      expect(elapsed).toBeLessThan(5000);
    }, 15000);

    it("handles a stream that ends mid-frame without crashing", async () => {
      const result = await pk.send({
        spec: makeSpec(),
        target: { operationId: "truncatedChat" },
        serverUrl: server.baseUrl,
      });

      expect(result.protocol).toBe("sse");
      expect(result.response.status).toBe(200);
      expect(result.response.events?.length ?? 0).toBeGreaterThan(0);

      const first = result.response.events?.[0];
      expect(first).toBeDefined();
      expect(first?.data).toContain('"seq":1');
    });
  });

  describe("WebSocket", () => {
    it("sends outbound frames and receives inbound frames", async () => {
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
      expect(directions.includes("in")).toBe(true);
      expect(result.response.truncated).toBe(true);
    });
  });
});
