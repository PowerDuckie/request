import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildRunOptions } from "../../src/protocols/http/runner-options";

describe("buildRunOptions", () => {
  const input = {
    baseUrl: "http://127.0.0.1:4000/v1",
    streaming: false,
  };

  it("applies defaults when nothing is supplied", () => {
    const options = buildRunOptions({} as any, input) as any;
    expect(options).toBeDefined();
    expect(options.requester).toBeDefined();
    expect(options.iterationCount).toBe(1);
  });

  it("lets SendOptions timeout override the default", () => {
    const options = buildRunOptions({ timeout: 5000 } as any, input) as any;
    expect(options.timeout.request).toBe(5000);
  });

  it("lets runner override convenience timeout", () => {
    const options = buildRunOptions(
      {
        timeout: 5000,
        runner: {
          timeout: { request: 9000 },
        },
      } as any,
      input,
    ) as any;

    expect(options.timeout.request).toBe(9000);
  });

  it("deep merges nested requester options", () => {
    const options = buildRunOptions(
      {
        runner: {
          requester: {
            verbose: false,
          },
        },
      } as any,
      input,
    ) as any;

    expect(options.requester.verbose).toBe(false);
    expect(options.requester).toHaveProperty("timings");
  });

  it("passes through unknown options", () => {
    const options = buildRunOptions(
      {
        runner: {
          someFutureOption: { nested: 1 },
        },
      } as any,
      input,
    ) as any;

    expect(options.someFutureOption).toEqual({ nested: 1 });
  });

  it("preserves function references", () => {
    const resolver = (_: unknown, cb: () => void) => cb();

    const options = buildRunOptions(
      {
        runner: {
          fileResolver: fs,
          secretResolver: resolver,
        },
      } as any,
      input,
    ) as any;

    expect(options.fileResolver).toBe(fs);
    expect(options.secretResolver).toBe(resolver);
  });

  it("creates an environment using baseUrl input", () => {
    const options = buildRunOptions({} as any, input) as any;
    expect(options.environment).toBeDefined();
  });

  it("does not mutate caller runner options", () => {
    const runner = {
      requester: {
        verbose: true,
      },
    };

    const snapshot = structuredClone(runner);
    buildRunOptions({ runner } as any, input);

    expect(runner).toEqual(snapshot);
  });

  it("rejects maxResponseSize: 0", () => {
    expect(() =>
      buildRunOptions(
        { spec: {}, target: {}, runner: { requester: { maxResponseSize: 0 } } },
        { baseUrl: "http://localhost", streaming: true },
      ),
    ).toThrow(/maxResponseSize must be a positive number/);
  });

  it("keeps a positive maxResponseSize on streaming requests", () => {
    const options = buildRunOptions(
      {
        spec: {},
        target: {},
        runner: { requester: { maxResponseSize: 1024 } },
      } as any,
      { baseUrl: "http://localhost", streaming: true },
    ) as any;
    expect(options.requester.maxResponseSize).toBe(1024);
  });
});
