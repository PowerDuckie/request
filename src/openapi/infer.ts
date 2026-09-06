import type { Json } from "../core/types";
import { mergeSchema } from "./merge";

const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URI = /^https?:\/\/\S+$/i;

export interface InferOptions {
  /** Maximum nesting depth to inspect. Defaults to 12. */
  maxDepth?: number;
  /** Number of array elements sampled when unifying item schemas. Defaults to 20. */
  sampleArrayItems?: number;
  /** Maximum characters retained in string examples. Defaults to 120. */
  maxExampleLength?: number;
  /** Emit example values alongside the inferred schema. Defaults to true. */
  includeExamples?: boolean;
}

/** Derive a JSON Schema from an observed runtime value. */
export function inferSchema(
  value: Json,
  options: InferOptions = {},
  depth = 0,
): any {
  const maxDepth = options.maxDepth ?? 12;
  const withExamples = options.includeExamples !== false;
  if (depth > maxDepth) return {};
  if (value === null || value === undefined) return { type: "null" };

  const kind = typeof value;

  if (kind === "boolean")
    return withExamples
      ? { type: "boolean", examples: [value] }
      : { type: "boolean" };

  if (kind === "number") {
    const numeric = value as number;
    if (!Number.isFinite(numeric)) return { type: "number" };
    const type = Number.isInteger(numeric) ? "integer" : "number";
    return withExamples ? { type, examples: [numeric] } : { type };
  }

  if (kind === "string") {
    const text = value as string;
    const schema: Record<string, any> = { type: "string" };
    if (ISO_DATE_TIME.test(text)) schema.format = "date-time";
    else if (ISO_DATE.test(text)) schema.format = "date";
    else if (UUID.test(text)) schema.format = "uuid";
    else if (URI.test(text)) schema.format = "uri";
    else if (EMAIL.test(text)) schema.format = "email";
    if (withExamples) {
      const limit = options.maxExampleLength ?? 120;
      schema.examples = [
        text.length > limit ? `${text.slice(0, limit)}...` : text,
      ];
    }
    return schema;
  }

  if (Array.isArray(value)) {
    if (!value.length) return { type: "array", items: {} };
    const sampleCount = Math.min(value.length, options.sampleArrayItems ?? 20);
    let items = inferSchema(value[0], options, depth + 1);
    for (let i = 1; i < sampleCount; i += 1) {
      items = mergeSchema(items, inferSchema(value[i], options, depth + 1), 0);
    }
    return { type: "array", items };
  }

  if (kind === "object") {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [key, entry] of Object.entries(value as Record<string, Json>)) {
      properties[key] = inferSchema(entry, options, depth + 1);
      // A null observation does not prove the field is absent, but it is
      // weak evidence, so only non-null fields are treated as required.
      if (entry !== null && entry !== undefined) required.push(key);
    }
    const schema: Record<string, any> = { type: "object", properties };
    if (required.length) schema.required = required;
    return schema;
  }

  // Functions, symbols and bigints cannot appear in decoded JSON.
  return {};
}

/** Fold a list of observed values into a single unified schema. */
export function inferSchemaFromMany(
  values: Json[],
  options: InferOptions = {},
): any {
  let schema: any = null;
  for (const value of values) {
    schema = schema
      ? mergeSchema(schema, inferSchema(value, options), 0)
      : inferSchema(value, options);
  }
  return schema ?? {};
}
