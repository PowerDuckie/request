const TYPE_ORDER = [
  "null",
  "boolean",
  "integer",
  "number",
  "string",
  "array",
  "object",
];

const asArray = (type: unknown): string[] => {
  if (type == null) return [];
  return Array.isArray(type)
    ? type.filter((t) => typeof t === "string")
    : typeof type === "string"
      ? [type]
      : [];
};

/**
 * Merge two JSON Schemas into their least upper bound.
 * Types become a union, object properties are unioned, and `required`
 * shrinks to the intersection so optional fields stay optional.
 */
export function mergeSchema(a: any, b: any, depth = 0): any {
  if (!a || typeof a !== "object") return b ?? a;
  if (!b || typeof b !== "object") return a;
  if (depth > 20) return {};

  // Preserve an existing $ref rather than inlining live observations over it.
  if (typeof a.$ref === "string") return a;
  if (typeof b.$ref === "string") return b;

  const out: Record<string, any> = {};

  let types = Array.from(new Set([...asArray(a.type), ...asArray(b.type)]));
  // An integer is a number; keep only the wider type when both are present.
  if (types.includes("integer") && types.includes("number"))
    types = types.filter((t) => t !== "integer");
  types.sort((x, y) => TYPE_ORDER.indexOf(x) - TYPE_ORDER.indexOf(y));
  if (types.length === 1) out.type = types[0];
  else if (types.length > 1) out.type = types;

  // A format only survives when both sides agree on it.
  if (a.format && a.format === b.format) out.format = a.format;

  if (a.properties || b.properties) {
    const properties: Record<string, any> = { ...(a.properties ?? {}) };
    for (const [key, value] of Object.entries<any>(b.properties ?? {})) {
      properties[key] = properties[key]
        ? mergeSchema(properties[key], value, depth + 1)
        : value;
    }
    out.properties = properties;

    const requiredA: string[] = Array.isArray(a.required) ? a.required : [];
    const requiredB: string[] = Array.isArray(b.required) ? b.required : [];
    if (a.properties && b.properties) {
      const intersection = requiredA.filter((key) => requiredB.includes(key));
      if (intersection.length) out.required = intersection;
    } else {
      const inherited = a.properties ? requiredA : requiredB;
      if (inherited.length) out.required = inherited;
    }
  }

  if (a.items || b.items) out.items = mergeSchema(a.items, b.items, depth + 1);

  if (a.additionalProperties || b.additionalProperties) {
    const av = a.additionalProperties;
    const bv = b.additionalProperties;
    out.additionalProperties =
      typeof av === "object" && typeof bv === "object"
        ? mergeSchema(av, bv, depth + 1)
        : (av ?? bv);
  }

  // Enums only stay meaningful when both sides declare one.
  if (Array.isArray(a.enum) && Array.isArray(b.enum)) {
    out.enum = Array.from(new Set([...a.enum, ...b.enum])).slice(0, 50);
  }

  const examples = dedupeExamples([
    ...(a.examples ?? []),
    ...(b.examples ?? []),
  ]).slice(0, 3);
  if (examples.length) out.examples = examples;

  for (const key of [
    "title",
    "description",
    "deprecated",
    "readOnly",
    "writeOnly",
  ] as const) {
    if (a[key] !== undefined || b[key] !== undefined)
      out[key] = a[key] ?? b[key];
  }

  return out;
}

function dedupeExamples(list: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const item of list) {
    let key: string;
    try {
      key = JSON.stringify(item);
    } catch {
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
