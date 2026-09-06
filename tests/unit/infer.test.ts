import { describe, expect, it } from "vitest";
import { inferSchema, inferSchemaFromMany } from "../../src/openapi/infer";
import { mergeSchema } from "../../src/openapi/merge";

describe("inferSchema", () => {
  it("infers primitive types", () => {
    expect(inferSchema("x")).toMatchObject({ type: "string" });
    expect(inferSchema(42)).toMatchObject({ type: "integer" });
    expect(inferSchema(4.2)).toMatchObject({ type: "number" });
    expect(inferSchema(true)).toMatchObject({ type: "boolean" });
  });

  it("represents null as type null", () => {
    const schema = inferSchema({ a: null }) as any;
    expect(schema.properties.a).toEqual({ type: "null" });
  });

  it("marks all observed keys required in a single object observation", () => {
    const schema = inferSchema({ id: "1", name: "n" }) as any;
    expect(schema.required.sort()).toEqual(["id", "name"]);
  });

  it("detects common string formats", () => {
    const schema = inferSchema({
      email: "a@b.com",
      when: "2026-09-06T00:00:00.000Z",
    }) as any;

    expect(schema.properties.email.format).toBe("email");
    expect(schema.properties.when.format).toBe("date-time");
  });

  it("collapses homogeneous arrays into one items schema", () => {
    const schema = inferSchema(["a", "b", "c"]) as any;
    expect(schema.type).toBe("array");
    expect(schema.items.type).toBe("string");
  });

  it("produces items for an empty array", () => {
    const schema = inferSchema([]) as any;
    expect(schema.type).toBe("array");
    expect(schema).toHaveProperty("items");
  });

  it("handles deep nesting", () => {
    let value: any = "leaf";
    for (let i = 0; i < 200; i += 1) {
      value = { nested: value };
    }

    expect(() => inferSchema(value)).not.toThrow();
  });
});

describe("mergeSchema", () => {
  it("intersects required fields across observations", () => {
    const merged = mergeSchema(
      inferSchema({ id: "1", name: "n", email: "a@b.com" }),
      inferSchema({ id: "2", name: "m" }),
    ) as any;

    expect(merged.required.sort()).toEqual(["id", "name"]);
    expect(merged.properties).toHaveProperty("email");
  });

  it("unions property sets", () => {
    const merged = mergeSchema(
      inferSchema({ a: 1 }),
      inferSchema({ b: 2 }),
    ) as any;

    expect(Object.keys(merged.properties).sort()).toEqual(["a", "b"]);
    expect(merged.required).toBeUndefined();
  });

  it("widens integer and number to number", () => {
    const merged = mergeSchema(inferSchema(1), inferSchema(1.5)) as any;
    expect(merged.type).toBe("number");
  });

  it("is idempotent", () => {
    const one = inferSchema({ id: "1", tags: ["a"] });
    expect(mergeSchema(one, one)).toEqual(one);
  });

  it("does not mutate its inputs", () => {
    const a = inferSchema({ id: "1" });
    const b = inferSchema({ name: "n" });
    const snapshotA = structuredClone(a);
    const snapshotB = structuredClone(b);

    mergeSchema(a, b);

    expect(a).toEqual(snapshotA);
    expect(b).toEqual(snapshotB);
  });

  it("leaves a $ref untouched", () => {
    const ref = { $ref: "#/components/schemas/User" };
    expect(mergeSchema(ref, inferSchema({ id: "1" }))).toEqual(ref);
  });
});

describe("inferSchemaFromMany", () => {
  it("folds multiple observations into one schema", () => {
    const schema = inferSchemaFromMany([
      { id: "1", name: "A", email: "a@b.com" },
      { id: "2", name: "B" },
    ]) as any;

    expect(schema.type).toBe("object");
    expect(schema.required.sort()).toEqual(["id", "name"]);
    expect(schema.properties).toHaveProperty("email");
  });
});