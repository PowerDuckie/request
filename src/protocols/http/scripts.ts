import type { ScriptSource, ScriptConfig } from "../../core/types";

export interface PostmanEvent {
  listen: "prerequest" | "test";
  script: { id?: string; type: "text/javascript"; exec: string[] };
}

function normalizeSources(
  input?: ScriptSource | ScriptSource[],
): ScriptSource[] {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list.filter(
    (entry): entry is ScriptSource => !!entry && entry.exec != null,
  );
}

function toExecLines(exec: string | string[]): string[] {
  if (Array.isArray(exec)) return exec.map((line) => String(line));
  return String(exec).split(/\r?\n/);
}

function toEvents(
  listen: "prerequest" | "test",
  sources: ScriptSource[],
): PostmanEvent[] {
  return sources
    .map((source, index) => ({
      listen,
      script: {
        id: source.id ?? `protokit-${listen}-${index}`,
        type: "text/javascript" as const,
        exec: toExecLines(source.exec),
      },
    }))
    .filter((event) =>
      event.script.exec.some((line) => line.trim().length > 0),
    );
}

/**
 * Read inline scripts from an `x-postman-scripts` extension.
 * Accepts a string, an array of lines, a ScriptSource, or an array of those.
 */
function readSpecScripts(node: any): {
  pre: ScriptSource[];
  test: ScriptSource[];
} {
  const extension = node?.["x-postman-scripts"];
  if (!extension || typeof extension !== "object") return { pre: [], test: [] };

  const coerce = (value: unknown): ScriptSource[] => {
    if (value == null) return [];
    if (typeof value === "string") return [{ exec: value }];
    if (Array.isArray(value)) {
      if (!value.length) return [];
      // An array of strings is a single multi-line script.
      if (typeof value[0] === "string") return [{ exec: value as string[] }];
      return (value as ScriptSource[]).filter(
        (entry) => entry && entry.exec != null,
      );
    }
    if (typeof value === "object" && (value as ScriptSource).exec != null)
      return [value as ScriptSource];
    return [];
  };

  return {
    pre: coerce(
      extension.preRequest ??
        extension.prerequest ??
        extension.collectionPreRequest,
    ),
    test: coerce(extension.test ?? extension.tests ?? extension.collectionTest),
  };
}

export function buildCollectionEvents(
  spec: any,
  config?: ScriptConfig,
): PostmanEvent[] {
  const fromSpec =
    config?.fromSpecExtensions === false
      ? { pre: [], test: [] }
      : readSpecScripts(spec);
  return [
    ...toEvents("prerequest", [
      ...fromSpec.pre,
      ...normalizeSources(config?.collectionPreRequest),
    ]),
    ...toEvents("test", [
      ...fromSpec.test,
      ...normalizeSources(config?.collectionTest),
    ]),
  ];
}

export function buildItemEvents(
  operation: any,
  config?: ScriptConfig,
): PostmanEvent[] {
  const fromSpec =
    config?.fromSpecExtensions === false
      ? { pre: [], test: [] }
      : readSpecScripts(operation);
  return [
    ...toEvents("prerequest", [
      ...fromSpec.pre,
      ...normalizeSources(config?.preRequest),
    ]),
    ...toEvents("test", [...fromSpec.test, ...normalizeSources(config?.test)]),
  ];
}

/** Optional helper script that exposes the last response to subsequent requests. */
export const BUILTIN_CAPTURE_TEST: ScriptSource = {
  id: "protokit-capture",
  exec: [
    "try {",
    "  pm.environment.set('__lastStatus', String(pm.response.code));",
    "  var contentType = pm.response.headers.get('content-type') || '';",
    "  if (/json/i.test(contentType)) {",
    "    pm.environment.set('__lastBody', pm.response.text());",
    "  }",
    "} catch (error) {",
    "  console.warn('protokit capture failed: ' + error.message);",
    "}",
  ],
};
