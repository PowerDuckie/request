import { err } from "../core/errors";

const CYCLE_MARKER = "__protokit_cycle__";

/**
 * Resolver for local JSON pointers. External references are rejected explicitly
 * rather than silently producing an empty schema.
 */
export function createResolver(root: any) {
  const deepCache = new Map<string, any>();

  function byPointer(pointer: string): any {
    if (typeof pointer !== "string" || !pointer.startsWith("#/")) {
      throw err(
        "EXTERNAL_REF",
        `Only local $ref pointers are supported, got: ${pointer}`,
      );
    }
    let current = root;
    const segments = pointer.slice(2).split("/");
    for (const raw of segments) {
      if (current == null || typeof current !== "object") {
        throw err("BAD_REF", `Cannot resolve pointer "${pointer}"`);
      }
      const key = decodeURIComponent(raw)
        .replace(/~1/g, "/")
        .replace(/~0/g, "~");
      current = current[key];
    }
    if (current === undefined)
      throw err("BAD_REF", `Pointer "${pointer}" resolves to undefined`);
    return current;
  }

  /** Resolve only the top-level $ref chain. */
  function deref<T = any>(node: any): T {
    let current = node;
    const visited = new Set<string>();
    let hops = 0;
    while (
      current &&
      typeof current === "object" &&
      typeof current.$ref === "string"
    ) {
      if (visited.has(current.$ref) || ++hops > 100) {
        return { type: "object", [CYCLE_MARKER]: true } as any;
      }
      visited.add(current.$ref);
      current = byPointer(current.$ref);
    }
    return current as T;
  }

  /** Fully expand a subtree, collapsing cycles into a generic object schema. */
  function deepDeref(node: any, depth = 0, stack: Set<any> = new Set()): any {
    if (node == null || typeof node !== "object") return node;
    if (depth > 32) return { type: "object" };

    const resolved = deref(node);
    if (resolved == null || typeof resolved !== "object") return resolved;
    if ((resolved as any)[CYCLE_MARKER]) return { type: "object" };
    if (stack.has(resolved)) return { type: "object" };

    const nextStack = new Set(stack);
    nextStack.add(resolved);

    if (Array.isArray(resolved)) {
      return resolved.map((entry) => deepDeref(entry, depth + 1, nextStack));
    }

    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(resolved)) {
      if (key === CYCLE_MARKER) continue;
      out[key] = deepDeref(value, depth + 1, nextStack);
    }
    return out;
  }

  /** Cached deep dereference, keyed by the originating $ref when present. */
  function deepDerefCached(node: any): any {
    const key = node && typeof node === "object" ? node.$ref : undefined;
    if (typeof key === "string" && deepCache.has(key))
      return deepCache.get(key);
    const value = deepDeref(node);
    if (typeof key === "string") deepCache.set(key, value);
    return value;
  }

  return { deref, deepDeref: deepDerefCached, byPointer };
}
