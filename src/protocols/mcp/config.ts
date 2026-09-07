import type { SendOptions, McpOptions } from "../../core/types";
import type { LocatedOperation } from "../../openapi/locate";
import { resolveServerUrl } from "../http/environment";
import { interpolate, isPlainObject } from "../../core/utils";
import { sampleFromSchema } from "../../openapi/sample";
import { err } from "../../core/errors";

export interface ResolvedMcpConfig {
  endpoint: string;
  method: string;
  /** Fully-formed JSON-RPC `params` for `method`. */
  params: Record<string, unknown>;
  headers: Record<string, string>;
  sessionId?: string;
  clientInfo: { name: string; version: string };
}

const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|apikey|api_key|credential|private)/i;

export { SECRET_KEY_PATTERN };

const KNOWN_METHODS = new Set([
  "tools/call",
  "resources/read",
  "prompts/get",
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "prompts/list",
]);

/**
 * Resolve the effective MCP call.
 *
 * Precedence: `options.mcp.*` (per-call override) > `operation['x-mcp'].*`
 * (the document's declared capability, normally produced by
 * {@link writeMcpOperations}).
 */
export function resolveMcpConfig(
  located: LocatedOperation,
  spec: any,
  options: SendOptions,
): ResolvedMcpConfig {
  const mcp: McpOptions = options.mcp ?? {};
  const rawExtension = located.operation?.["x-mcp"];
  const extension: Record<string, any> =
    rawExtension && typeof rawExtension === "object" ? rawExtension : {};
  const variableMap: Record<string, string> = { ...(options.variables ?? {}) };

  let endpoint: string;
  if (mcp.endpoint) {
    endpoint = mcp.endpoint;
  } else if (typeof extension.endpoint === "string" && extension.endpoint) {
    endpoint = extension.endpoint;
  } else {
    endpoint = resolveServerUrl(located.servers, options);
  }
  endpoint = interpolate(endpoint, variableMap);
  if (/\{\{[^}]+\}\}/.test(endpoint)) {
    throw err("BAD_MCP_ENDPOINT", `Unresolved variable in MCP endpoint: ${endpoint}`);
  }
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("not http(s)");
  } catch {
    throw err("BAD_MCP_ENDPOINT", `MCP endpoint must be an absolute http(s) URL, received: ${endpoint}`);
  }

  const method = mcp.method ?? extension.method;
  if (typeof method !== "string" || !KNOWN_METHODS.has(method)) {
    throw err(
      "BAD_MCP_METHOD",
      `options.mcp.method (or x-mcp.method) must be one of: ${Array.from(KNOWN_METHODS).join(", ")}. Received: ${JSON.stringify(method)}`,
    );
  }

  const name = mcp.name ?? extension.name;
  const declaredArgs = isPlainObject(extension.arguments) ? extension.arguments : undefined;
  const declaredSchema = isPlainObject(extension.argumentsSchema) ? extension.argumentsSchema : undefined;
  const sampledArgs = declaredSchema ? sampleFromSchema(declaredSchema) : undefined;
  const fromValues = isPlainObject(options.values?.body) ? (options.values!.body as Record<string, unknown>) : undefined;

  const args: Record<string, unknown> = {
    ...(isPlainObject(sampledArgs) ? sampledArgs : {}),
    ...(declaredArgs ?? {}),
    ...(fromValues ?? {}),
    ...(mcp.arguments ?? {}),
  };

  let params: Record<string, unknown>;
  if (method === "tools/call") {
    if (!name) throw err("BAD_MCP_TARGET", "tools/call requires options.mcp.name (or x-mcp.name).");
    params = { name, arguments: args };
  } else if (method === "prompts/get") {
    if (!name) throw err("BAD_MCP_TARGET", "prompts/get requires options.mcp.name (or x-mcp.name).");
    params = { name, arguments: args };
  } else if (method === "resources/read") {
    const uri = (args as any).uri ?? extension.uri ?? mcp.arguments?.uri;
    if (typeof uri !== "string" || !uri) {
      throw err("BAD_MCP_TARGET", "resources/read requires a `uri` (via options.mcp.arguments.uri or x-mcp.uri).");
    }
    params = { uri };
  } else {
    // The three *_list methods take an optional cursor and nothing else.
    params = args;
  }

  /* ---- Headers ---- */
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const applyHeaders = (source: unknown) => {
    if (!isPlainObject(source)) return;
    for (const [key, value] of Object.entries(source)) {
      if (value == null) continue;
      if (key === "__proto__" || key === "constructor") continue;
      headers[key] = interpolate(String(value), variableMap);
    }
  };
  applyHeaders(options.values?.header);
  applyHeaders(extension.headers);
  applyHeaders(mcp.headers);

  const auth = options.auth;
  if (auth && auth.type !== "none" && !hasHeader(headers, "authorization")) {
    if (auth.type === "bearer") {
      headers.Authorization = `Bearer ${auth.token ?? ""}`;
    } else if (auth.type === "basic") {
      const raw = `${auth.username ?? ""}:${auth.password ?? ""}`;
      headers.Authorization = `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
    } else if (auth.type === "apikey" && (auth.in ?? "header") === "header") {
      headers[auth.key ?? "X-API-Key"] = auth.value ?? "";
    }
  }

  return {
    endpoint,
    method,
    params,
    headers,
    sessionId: mcp.sessionId ?? optionalText(extension.sessionId),
    clientInfo: mcp.clientInfo ?? { name: "protokit", version: "0.1.0" },
  };
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}
