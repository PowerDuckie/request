/**
 * Produce a representative value for a JSON Schema so that required
 * parameters and request bodies are never left empty.
 */
export function sampleFromSchema(schema: any, depth = 0): any {
  if (!schema || typeof schema !== "object" || depth > 12) return null;

  if (schema.example !== undefined) return schema.example;

  if (schema.examples !== undefined) {
    if (Array.isArray(schema.examples) && schema.examples.length)
      return schema.examples[0];
    if (typeof schema.examples === "object") {
      const first = Object.values<any>(schema.examples)[0];
      if (first !== undefined)
        return first && typeof first === "object" && "value" in first
          ? first.value
          : first;
    }
  }

  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    return schema.allOf.reduce((acc: any, sub: any) => {
      const value = sampleFromSchema(sub, depth + 1);
      if (value && typeof value === "object" && !Array.isArray(value))
        return { ...acc, ...value };
      return value !== null && value !== undefined ? value : acc;
    }, {});
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    if (Array.isArray(schema[key]) && schema[key].length)
      return sampleFromSchema(schema[key][0], depth + 1);
  }

  const declared = Array.isArray(schema.type)
    ? (schema.type.find((t: string) => t !== "null") ?? "null")
    : schema.type;
  const effective =
    declared ??
    (schema.properties
      ? "object"
      : schema.items
        ? "array"
        : schema.format
          ? "string"
          : "string");

  switch (effective) {
    case "object": {
      const out: Record<string, any> = {};
      const required: string[] = Array.isArray(schema.required)
        ? schema.required
        : [];
      const properties =
        schema.properties && typeof schema.properties === "object"
          ? schema.properties
          : {};
      for (const [key, sub] of Object.entries<any>(properties)) {
        if (sub && sub.readOnly === true) continue;
        // Beyond a shallow depth, keep only required fields to avoid explosion.
        if (depth > 2 && required.length && !required.includes(key)) continue;
        out[key] = sampleFromSchema(sub, depth + 1);
      }
      if (
        !Object.keys(out).length &&
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object"
      ) {
        out.key = sampleFromSchema(schema.additionalProperties, depth + 1);
      }
      return out;
    }
    case "array": {
      const count = Math.max(1, Math.min(Number(schema.minItems) || 1, 2));
      return Array.from({ length: count }, () =>
        sampleFromSchema(schema.items, depth + 1),
      );
    }
    case "integer":
      return clampNumber(schema, Math.trunc(schema.minimum ?? 0));
    case "number":
      return clampNumber(schema, schema.minimum ?? 0);
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return sampleString(schema);
  }
}

function clampNumber(schema: any, base: number): number {
  let value = base;
  if (typeof schema.minimum === "number" && value < schema.minimum)
    value = schema.minimum;
  if (typeof schema.maximum === "number" && value > schema.maximum)
    value = schema.maximum;
  return value;
}

function sampleString(schema: any): string {
  switch (schema.format) {
    case "date-time":
      return new Date().toISOString();
    case "date":
      return new Date().toISOString().slice(0, 10);
    case "time":
      return new Date().toISOString().slice(11, 19);
    case "uuid":
      return "00000000-0000-4000-8000-000000000000";
    case "email":
      return "user@example.com";
    case "hostname":
      return "example.com";
    case "ipv4":
      return "127.0.0.1";
    case "ipv6":
      return "::1";
    case "uri":
    case "url":
    case "uri-reference":
      return "https://example.com";
    case "byte":
      return "";
    case "binary":
      return "";
    case "password":
      return "password";
    default: {
      // Never fabricate a value that would violate an explicit pattern.
      if (typeof schema.pattern === "string") return "";
      const min = Number(schema.minLength) || 0;
      const base = "string";
      return min > base.length ? base.padEnd(min, "x") : base;
    }
  }
}
