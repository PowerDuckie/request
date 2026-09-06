import { describe, expect, it } from "vitest";
import { sampleFromSchema } from "../../src/openapi/sample";

describe("sampleFromSchema", () => {
  it("prefers example over generated values", () => {
    expect(sampleFromSchema({ type: "string", example: "fixed" })).toBe(
      "fixed",
    );
  });

  it("prefers the first entry of the 3.1+ examples array", () => {
    expect(sampleFromSchema({ type: "string", examples: ["one", "two"] })).toBe(
      "one",
    );
  });

  it("honors default and enum", () => {
    expect(sampleFromSchema({ type: "string", default: "d" })).toBe("d");
    expect(sampleFromSchema({ type: "string", enum: ["a", "b"] })).toBe("a");
  });

  it("respects numeric minimum", () => {
    expect(
      sampleFromSchema({ type: "integer", minimum: 5 }),
    ).toBeGreaterThanOrEqual(5);
  });

  it("drops optional fields once depth exceeds two", () => {
    const schema = {
      type: "object",
      required: ["l1"],
      properties: {
        l1: {
          type: "object",
          required: ["l2"],
          properties: {
            l2: {
              type: "object",
              required: ["l3"],
              properties: {
                l3: {
                  type: "object",
                  required: ["keep"],
                  properties: {
                    keep: { type: "string" },
                    drop: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    };
    const sample = sampleFromSchema(schema) as any;
    expect(sample.l1.l2.l3).toHaveProperty("keep");
    expect(sample.l1.l2.l3).not.toHaveProperty("drop");
  });

  it("terminates on a self-referential schema", () => {
    const node: any = { type: "object", properties: {} };
    node.properties.child = node;
    expect(() => sampleFromSchema(node)).not.toThrow();
  });

  it("picks the first branch of oneOf and anyOf", () => {
    expect(
      sampleFromSchema({ oneOf: [{ type: "string" }, { type: "integer" }] }),
    ).toEqual(expect.any(String));

    expect(
      sampleFromSchema({ anyOf: [{ type: "string" }, { type: "integer" }] }),
    ).toEqual(expect.any(String));
  });

  it("merges allOf members", () => {
    const sample = sampleFromSchema({
      allOf: [
        {
          type: "object",
          required: ["a"],
          properties: { a: { type: "string" } },
        },
        {
          type: "object",
          required: ["b"],
          properties: { b: { type: "integer" } },
        },
      ],
    }) as any;
    expect(sample).toHaveProperty("a");
    expect(sample).toHaveProperty("b");
  });
});