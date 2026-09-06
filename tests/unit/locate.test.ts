import { describe, expect, it } from "vitest";
import { locateOperation } from "../../src/openapi/locate";
import { makeSpec } from "../helpers/spec";

describe("locateOperation", () => {
  it("finds an operation by operationId", () => {
    const found = locateOperation(makeSpec() as any, {
      operationId: "getUser",
    });

    expect(found.path).toBe("/users/{id}");
    expect(found.method).toBe("get");
  });

  it("finds an operation by path and method", () => {
    const found = locateOperation(makeSpec() as any, {
      path: "/orders",
      method: "post",
    });

    expect(found.operation.operationId).toBe("createOrder");
  });

  it("accepts uppercase method names", () => {
    const found = locateOperation(makeSpec() as any, {
      path: "/orders",
      method: "POST" as any,
    });

    expect(found.operation.operationId).toBe("createOrder");
  });

  it("merges path-level parameters into operation parameters", () => {
    const found = locateOperation(makeSpec() as any, {
      operationId: "getUser",
    });

    const names = found.parameters.map((p: any) => p.name).sort();
    expect(names).toEqual(["id", "include"]);
  });

  it("lets operation-level parameters override path-level ones", () => {
    const spec = makeSpec() as any;

    spec.paths["/users/{id}"].get.parameters.push({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "integer" },
    });

    const found = locateOperation(spec, { operationId: "getUser" });
    const ids = found.parameters.filter(
      (p: any) => p.name === "id" && p.in === "path",
    );

    expect(ids).toHaveLength(1);
    expect(ids[0].schema.type).toBe("integer");
  });

  it("throws a helpful error for missing operationId", () => {
    expect(() =>
      locateOperation(makeSpec() as any, { operationId: "missing" }),
    ).toThrow(/missing/);
  });

  it("throws a helpful error for unknown path", () => {
    expect(() =>
      locateOperation(makeSpec() as any, {
        path: "/ghost",
        method: "get",
      }),
    ).toThrow(/ghost/i);
  });

  it("throws when the path exists but the method does not", () => {
    expect(() =>
      locateOperation(makeSpec() as any, {
        path: "/orders",
        method: "get",
      }),
    ).toThrow(/get/i);
  });

  it("rejects an empty target", () => {
    expect(() => locateOperation(makeSpec() as any, {} as any)).toThrow();
  });
});