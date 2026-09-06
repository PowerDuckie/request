/** Deep clone with a safe fallback for environments without structuredClone. */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(value);
    } catch {
      // Falls through to the JSON path (e.g. when the value holds functions).
    }
  }
  return jsonClone(value);
}

/** JSON-based clone that tolerates circular references by replacing them with null. */
export function jsonClone<T>(value: T): T {
  const seen = new WeakSet<object>();
  return JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (val && typeof val === "object") {
        if (seen.has(val as object)) return undefined;
        seen.add(val as object);
      }
      return val;
    }),
  );
}

/** Replace `{{name}}` placeholders using the provided variable map. */
export function interpolate(
  input: unknown,
  vars: Record<string, string>,
): string {
  const source = input == null ? "" : String(input);
  if (source.indexOf("{{") === -1) return source;
  return source.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

/**
 * Recursively merge `override` into `base`.
 * Arrays and class instances are replaced wholesale rather than merged,
 * because runtime options such as VariableScope must not be structurally mixed.
 */
export function deepMerge<T extends Record<string, any>>(
  base: T,
  override?: Partial<T>,
): T {
  if (!override) return base;
  const out: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const prev = out[key];
    if (isPlainObject(prev) && isPlainObject(value)) {
      out[key] = deepMerge(prev, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export function isPlainObject(value: unknown): value is Record<string, any> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Guarantee a promise settles at most once, regardless of how many callbacks fire. */
export function createLatch<T>() {
  let settled = false;
  let resolveFn: (v: T) => void;
  let rejectFn: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value: T) {
      if (settled) return;
      settled = true;
      resolveFn(value);
    },
    reject(reason: unknown) {
      if (settled) return;
      settled = true;
      rejectFn(reason);
    },
  };
}

/** Safe timer helper that never throws on clear. */
export function safeClearTimeout(
  timer: ReturnType<typeof setTimeout> | null | undefined,
): null {
  if (timer) {
    try {
      clearTimeout(timer);
    } catch {
      /* ignore */
    }
  }
  return null;
}
