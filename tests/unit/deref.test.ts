import { describe, expect, it } from "vitest";
import { createResolver } from "../../src/openapi/deref";

describe("openapi/deref", () => {
  it("resolves a local schema ref", () => {
    const spec = {
      openapi: "3.1.0",
      components: {
        schemas: {
          User: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
            },
            required: ["id", "name"],
          },
        },
      },
    };

    const { deref } = createResolver(spec);

    const result = deref({
      $ref: "#/components/schemas/User",
    });

    expect(result).toEqual({
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
      },
      required: ["id", "name"],
    });
  });

  it("returns plain objects unchanged", () => {
    const spec = {
      openapi: "3.1.0",
      components: {},
    };

    const { deref } = createResolver(spec);

    const schema = {
      type: "object",
      properties: {
        ok: { type: "boolean" },
      },
    };

    expect(deref(schema)).toEqual(schema);
  });

  it("deepDeref recursively resolves nested refs", () => {
    const spec = {
      openapi: "3.1.0",
      components: {
        schemas: {
          UserId: { type: "string" },
          User: {
            type: "object",
            properties: {
              id: { $ref: "#/components/schemas/UserId" },
              profile: { $ref: "#/components/schemas/Profile" },
            },
          },
          Profile: {
            type: "object",
            properties: {
              nickname: { type: "string" },
            },
          },
        },
      },
    };

    const { deepDeref } = createResolver(spec);

    const result = deepDeref({
      $ref: "#/components/schemas/User",
    });

    expect(result).toEqual({
      type: "object",
      properties: {
        id: { type: "string" },
        profile: {
          type: "object",
          properties: {
            nickname: { type: "string" },
          },
        },
      },
    });
  });

  it("resolves values by JSON pointer", () => {
    const spec = {
      openapi: "3.1.0",
      components: {
        schemas: {
          User: {
            type: "object",
            properties: {
              id: { type: "string" },
            },
          },
        },
      },
    };

    const { byPointer } = createResolver(spec);

    expect(byPointer("#/components/schemas/User")).toEqual({
      type: "object",
      properties: {
        id: { type: "string" },
      },
    });
  });
});
