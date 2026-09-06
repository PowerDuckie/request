import { beforeEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "../../src/core/registry";
import type { ProtocolAdapter } from "../../src/core/protocol";

const httpAdapter: ProtocolAdapter<any> = {
  name: "http",
  supports: () => 1,
  plan: () => ({ kind: "http" }),
  execute: async () => ({}) as any,
};

const wsAdapter: ProtocolAdapter<any> = {
  name: "websocket",
  supports: (ctx) =>
    ctx.located.operation["x-protocol"] === "websocket" ? 10 : 0,
  plan: () => ({ kind: "ws" }),
  execute: async () => ({}) as any,
};

describe("AdapterRegistry", () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
    registry.register(httpAdapter);
    registry.register(wsAdapter);
  });

  it("falls back to http when no adapter scores higher", () => {
    const adapter = registry.resolve({
      spec: {} as any,
      options: {} as any,
      located: {
        path: "/users/{id}",
        method: "get",
        operation: {},
        parameters: [],
      } as any,
    });

    expect(adapter.name).toBe("http");
  });

  it("selects the highest scoring adapter", () => {
    const adapter = registry.resolve({
      spec: {} as any,
      options: {} as any,
      located: {
        path: "/realtime/{room}",
        method: "get",
        operation: { "x-protocol": "websocket" },
        parameters: [],
      } as any,
    });

    expect(adapter.name).toBe("websocket");
  });

  it("ignores adapters that score zero", () => {
    const neverAdapter: ProtocolAdapter<any> = {
      name: "never",
      supports: () => 0,
      plan: () => ({}),
      execute: async () => ({}) as any,
    };

    registry.register(neverAdapter);

    const adapter = registry.resolve({
      spec: {} as any,
      options: {} as any,
      located: {
        path: "/users/{id}",
        method: "get",
        operation: {},
        parameters: [],
      } as any,
    });

    expect(adapter.name).toBe("http");
  });

  it("is independent of registration order", () => {
    const reversed = new AdapterRegistry();
    reversed.register(wsAdapter);
    reversed.register(httpAdapter);

    const adapter = reversed.resolve({
      spec: {} as any,
      options: {} as any,
      located: {
        path: "/realtime/{room}",
        method: "get",
        operation: { "x-protocol": "websocket" },
        parameters: [],
      } as any,
    });

    expect(adapter.name).toBe("websocket");
  });

  it("does not let a throwing adapter break resolution", () => {
    const broken: ProtocolAdapter<any> = {
      name: "broken",
      supports: () => {
        throw new Error("bad scorer");
      },
      plan: () => ({}),
      execute: async () => ({}) as any,
    };

    registry.register(broken);

    expect(() =>
      registry.resolve({
        spec: {} as any,
        options: {} as any,
        located: {
          path: "/users/{id}",
          method: "get",
          operation: {},
          parameters: [],
        } as any,
      }),
    ).not.toThrow();
  });

  it("throws when nothing can handle the operation", () => {
    const empty = new AdapterRegistry();

    expect(() =>
      empty.resolve({
        spec: {} as any,
        options: {} as any,
        located: {
          path: "/users/{id}",
          method: "get",
          operation: {},
          parameters: [],
        } as any,
      }),
    ).toThrow(/adapter|matched/i);
  });
});
