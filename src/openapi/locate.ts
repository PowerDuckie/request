import { err } from "../core/errors";
import { createResolver } from "./deref";
import type { OperationTarget } from "../core/types";

/** Methods defined as fixed fields on a Path Item Object. */
const FIXED_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
  "query",
];

export interface LocatedOperation {
  path: string;
  /** Lower-cased method name; custom verbs come from `additionalOperations`. */
  method: string;
  /** True when the method came from `additionalOperations`. */
  isCustomMethod: boolean;
  /** Fully dereferenced Operation Object. */
  operation: any;
  pathItem: any;
  /** Path-level and operation-level parameters merged, operation wins. */
  parameters: any[];
  /** Effective servers, honoring operation > pathItem > document precedence. */
  servers: any[];
  security?: any[];
}

export function locateOperation(
  spec: any,
  target: OperationTarget,
): LocatedOperation {
  if (!spec || typeof spec !== "object")
    throw err("BAD_SPEC", "spec must be an object");
  if (typeof spec.openapi !== "string")
    throw err("BAD_SPEC", "spec.openapi version string is required");
  if (!target || typeof target !== "object")
    throw err("BAD_TARGET", "target is required");

  const resolver = createResolver(spec);
  const paths = spec.paths;
  if (!paths || typeof paths !== "object")
    throw err("BAD_SPEC", "spec.paths is missing or invalid");

  interface Candidate {
    path: string;
    method: string;
    rawOperation: any;
    pathItem: any;
    isCustomMethod: boolean;
  }

  const candidates: Candidate[] = [];
  for (const [pathKey, rawPathItem] of Object.entries<any>(paths)) {
    let pathItem: any;
    try {
      pathItem = resolver.deref(rawPathItem);
    } catch {
      continue; // A broken path item should not abort the whole lookup.
    }
    if (!pathItem || typeof pathItem !== "object") continue;

    for (const method of FIXED_METHODS) {
      if (pathItem[method] && typeof pathItem[method] === "object") {
        candidates.push({
          path: pathKey,
          method,
          rawOperation: pathItem[method],
          pathItem,
          isCustomMethod: false,
        });
      }
    }
    // OpenAPI 3.2 introduces additionalOperations for verbs such as LOCK or MKCOL.
    const additional = pathItem.additionalOperations;
    if (additional && typeof additional === "object") {
      for (const [method, operation] of Object.entries<any>(additional)) {
        if (!operation || typeof operation !== "object") continue;
        candidates.push({
          path: pathKey,
          method: method.toLowerCase(),
          rawOperation: operation,
          pathItem,
          isCustomMethod: true,
        });
      }
    }
  }

  if (!candidates.length)
    throw err("EMPTY_SPEC", "The document does not declare any operation");

  let hit: Candidate | undefined;
  if (target.operationId) {
    hit = candidates.find((c) => {
      try {
        return (
          resolver.deref(c.rawOperation)?.operationId === target.operationId
        );
      } catch {
        return false;
      }
    });
    if (!hit)
      throw err(
        "OP_NOT_FOUND",
        `operationId "${target.operationId}" was not found`,
      );
  } else {
    if (!target.path || !target.method) {
      throw err(
        "BAD_TARGET",
        "Provide either operationId, or both path and method",
      );
    }
    const method = String(target.method).toLowerCase();
    hit = candidates.find((c) => c.path === target.path && c.method === method);
    if (!hit) {
      throw err(
        "OP_NOT_FOUND",
        `Operation "${String(target.method).toUpperCase()} ${target.path}" was not found`,
      );
    }
  }

  const operation = resolver.deepDeref(hit.rawOperation) ?? {};
  const pathItem = resolver.deref(hit.pathItem) ?? {};

  // Operation-level parameters override path-level ones with the same in+name key.
  const merged = new Map<string, any>();
  const collect = (list: any) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      let resolved: any;
      try {
        resolved = resolver.deepDeref(entry);
      } catch {
        continue;
      }
      if (
        resolved &&
        typeof resolved.name === "string" &&
        typeof resolved.in === "string"
      ) {
        merged.set(`${resolved.in}:${resolved.name}`, resolved);
      }
    }
  };
  collect(pathItem.parameters);
  collect(hit.rawOperation.parameters);

  const servers = (Array.isArray(operation.servers) &&
    operation.servers.length &&
    operation.servers) ||
    (Array.isArray(pathItem.servers) &&
      pathItem.servers.length &&
      pathItem.servers) ||
    (Array.isArray(spec.servers) && spec.servers.length && spec.servers) || [
      { url: "/" },
    ];

  return {
    path: hit.path,
    method: hit.method,
    isCustomMethod: hit.isCustomMethod,
    operation,
    pathItem,
    parameters: Array.from(merged.values()),
    servers,
    security: operation.security ?? spec.security,
  };
}
