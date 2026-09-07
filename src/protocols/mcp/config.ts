import type { SendOptions, McpOptions } from "../../core/types";
import type { LocatedOperation } from "../../openapi/locate";
import { resolveServerUrl } from "../http/environment";
import { interpolate, isPlainObject } from "../../core/utils";
import { sampleFromSchema } from "../../openapi/sample";
import { err } from "../../core/errors";

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

export type McpTransport = "streamable-http" | "stdio";

const KNOWN_TRANSPORTS = new Set<McpTransport>(["streamable-http", "stdio"]);

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

export interface ResolvedMcpConfig {
  /**
   * MCP transport.
   *
   * - streamable-http: MCP Streamable HTTP transport
   * - stdio: spawned child-process stdin/stdout transport
   */
  transport: McpTransport;

  /* ----------------------------- HTTP transport ---------------------------- */

  /**
   * Required for streamable-http.
   */
  endpoint?: string;

  /* ----------------------------- stdio transport --------------------------- */

  /**
   * Required for stdio.
   *
   * Examples:
   *   node
   *   npx
   *   python
   *   uvx
   */
  command?: string;

  /**
   * Child-process arguments for stdio transport.
   */
  args?: string[];

  /**
   * Optional child-process working directory.
   */
  cwd?: string;

  /**
   * Optional child-process environment overrides.
   */
  env?: Record<string, string | undefined>;

  /**
   * stdio request timeout.
   */
  timeoutMs?: number;

  /**
   * Maximum buffered stdout bytes before failing.
   */
  maxBufferBytes?: number;

  /* ------------------------------- MCP request ----------------------------- */

  method: string;

  /**
   * Fully-formed JSON-RPC params for `method`.
   */
  params: Record<string, unknown>;

  /**
   * HTTP headers.
   *
   * Ignored by stdio transport except where the transport implementation
   * explicitly uses them for diagnostics or compatibility.
   */
  headers: Record<string, string>;

  sessionId?: string;

  /**
   * Only set when explicitly configured or negotiated.
   */
  protocolVersion?: string;

  clientInfo: {
    name: string;
    version: string;
  };
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Main resolver                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the effective MCP call.
 *
 * Precedence:
 *
 *   options.mcp.*
 *     >
 *   operation["x-mcp"].*
 *     >
 *   transport defaults
 *
 * Transport-specific validation:
 *
 *   streamable-http -> endpoint is required and must be absolute http(s)
 *   stdio           -> command is required
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

  const variableMap: Record<string, string> = {
    ...(options.variables ?? {}),
  };

  /* ------------------------------------------------------------------------ */
  /* Transport                                                                */
  /* ------------------------------------------------------------------------ */

  const transport = resolveTransport(mcp, extension);

  /* ------------------------------------------------------------------------ */
  /* Transport-specific config                                                */
  /* ------------------------------------------------------------------------ */

  let endpoint: string | undefined;
  let command: string | undefined;
  let args: string[] | undefined;
  let cwd: string | undefined;
  let env: Record<string, string | undefined> | undefined;
  let timeoutMs: number | undefined;
  let maxBufferBytes: number | undefined;

  if (transport === "streamable-http") {
    endpoint = resolveHttpEndpoint(
      located,
      options,
      mcp,
      extension,
      variableMap,
    );
  } else {
    const stdio = resolveStdioConfig(mcp, extension, variableMap);

    command = stdio.command;
    args = stdio.args;
    cwd = stdio.cwd;
    env = stdio.env;
    timeoutMs = stdio.timeoutMs;
    maxBufferBytes = stdio.maxBufferBytes;
  }

  /* ------------------------------------------------------------------------ */
  /* MCP method                                                               */
  /* ------------------------------------------------------------------------ */

  const method = mcp.method ?? extension.method;

  if (typeof method !== "string" || !KNOWN_METHODS.has(method)) {
    throw err(
      "BAD_MCP_METHOD",
      `options.mcp.method (or x-mcp.method) must be one of: ${Array.from(
        KNOWN_METHODS,
      ).join(", ")}. Received: ${JSON.stringify(method)}`,
    );
  }

  /* ------------------------------------------------------------------------ */
  /* MCP target / arguments                                                   */
  /* ------------------------------------------------------------------------ */

  const name = mcp.name ?? extension.name;

  const declaredArgs = isPlainObject(extension.arguments)
    ? extension.arguments
    : undefined;

  const declaredSchema = isPlainObject(extension.argumentsSchema)
    ? extension.argumentsSchema
    : undefined;

  const sampledArgs = declaredSchema
    ? sampleFromSchema(declaredSchema)
    : undefined;

  const fromValues = isPlainObject(options.values?.body)
    ? (options.values!.body as Record<string, unknown>)
    : undefined;

  const argsObject: Record<string, unknown> = {
    ...(isPlainObject(sampledArgs) ? sampledArgs : {}),
    ...(declaredArgs ?? {}),
    ...(fromValues ?? {}),
    ...(mcp.arguments ?? {}),
  };

  let params: Record<string, unknown>;

  if (method === "tools/call") {
    if (typeof name !== "string" || !name) {
      throw err(
        "BAD_MCP_TARGET",
        "tools/call requires options.mcp.name (or x-mcp.name).",
      );
    }

    params = {
      name,
      arguments: argsObject,
    };
  } else if (method === "prompts/get") {
    if (typeof name !== "string" || !name) {
      throw err(
        "BAD_MCP_TARGET",
        "prompts/get requires options.mcp.name (or x-mcp.name).",
      );
    }

    params = {
      name,
      arguments: argsObject,
    };
  } else if (method === "resources/read") {
    const uri = (argsObject as any).uri ?? extension.uri ?? mcp.arguments?.uri;

    if (typeof uri !== "string" || !uri) {
      throw err(
        "BAD_MCP_TARGET",
        "resources/read requires a `uri` (via options.mcp.arguments.uri or x-mcp.uri).",
      );
    }

    params = { uri };
  } else {
    /**
     * List methods take an optional cursor and no required target.
     */
    params = argsObject;
  }

  /* ------------------------------------------------------------------------ */
  /* Headers                                                                  */
  /* ------------------------------------------------------------------------ */

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const applyHeaders = (source: unknown): void => {
    if (!isPlainObject(source)) return;

    for (const [key, value] of Object.entries(source)) {
      if (value == null) continue;

      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }

      headers[key] = interpolate(String(value), variableMap);
    }
  };

  applyHeaders(options.values?.header);
  applyHeaders(extension.headers);
  applyHeaders(mcp.headers);

  /* ------------------------------------------------------------------------ */
  /* Auth                                                                     */
  /* ------------------------------------------------------------------------ */

  const auth = options.auth;

  if (auth && auth.type !== "none" && !hasHeader(headers, "Authorization")) {
    if (auth.type === "bearer") {
      headers.Authorization = `Bearer ${auth.token ?? ""}`;
    } else if (auth.type === "basic") {
      const raw = `${auth.username ?? ""}:${auth.password ?? ""}`;

      headers.Authorization = `Basic ${Buffer.from(raw, "utf8").toString(
        "base64",
      )}`;
    } else if (auth.type === "apikey" && (auth.in ?? "header") === "header") {
      headers[auth.key ?? "X-API-Key"] = auth.value ?? "";
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Final config                                                             */
  /* ------------------------------------------------------------------------ */

  return {
    transport,

    ...(endpoint ? { endpoint } : {}),

    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxBufferBytes !== undefined ? { maxBufferBytes } : {}),

    method,
    params,
    headers,

    sessionId: mcp.sessionId ?? optionalText(extension.sessionId),

    protocolVersion:
      mcp.protocolVersion ?? optionalText(extension.protocolVersion),

    clientInfo: normalizeClientInfo(
      mcp.clientInfo ?? extension.clientInfo,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Transport resolution                                                       */
/* -------------------------------------------------------------------------- */

function resolveTransport(
  mcp: McpOptions,
  extension: Record<string, any>,
): McpTransport {
  const raw = mcp.transport ?? extension.transport ?? "streamable-http";

  if (typeof raw !== "string" || !KNOWN_TRANSPORTS.has(raw as McpTransport)) {
    throw err(
      "BAD_MCP_TRANSPORT",
      `MCP transport must be one of: ${Array.from(KNOWN_TRANSPORTS).join(
        ", ",
      )}. Received: ${JSON.stringify(raw)}`,
    );
  }

  return raw as McpTransport;
}

/* -------------------------------------------------------------------------- */
/* HTTP resolution                                                            */
/* -------------------------------------------------------------------------- */

function resolveHttpEndpoint(
  located: LocatedOperation,
  options: SendOptions,
  mcp: McpOptions,
  extension: Record<string, any>,
  variableMap: Record<string, string>,
): string {
  let endpoint: string;

  if (typeof mcp.endpoint === "string" && mcp.endpoint) {
    endpoint = mcp.endpoint;
  } else if (typeof extension.endpoint === "string" && extension.endpoint) {
    endpoint = extension.endpoint;
  } else {
    endpoint = resolveServerUrl(located.servers, options);
  }

  endpoint = interpolate(endpoint, variableMap);

  if (/\{\{[^}]+\}\}/.test(endpoint)) {
    throw err(
      "BAD_MCP_ENDPOINT",
      `Unresolved variable in MCP endpoint: ${endpoint}`,
    );
  }

  try {
    const parsed = new URL(endpoint);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("not http(s)");
    }
  } catch {
    throw err(
      "BAD_MCP_ENDPOINT",
      `MCP endpoint must be an absolute http(s) URL, received: ${endpoint}`,
    );
  }

  return endpoint;
}

/* -------------------------------------------------------------------------- */
/* stdio resolution                                                           */
/* -------------------------------------------------------------------------- */

function resolveStdioConfig(
  mcp: McpOptions,
  extension: Record<string, any>,
  variableMap: Record<string, string>,
): {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxBufferBytes?: number;
} {
  const rawCommand = mcp.command ?? extension.command;

  if (typeof rawCommand !== "string" || !rawCommand.trim()) {
    throw err(
      "BAD_MCP_STDIO_COMMAND",
      "MCP stdio transport requires options.mcp.command (or x-mcp.command).",
    );
  }

  const command = interpolate(rawCommand.trim(), variableMap);

  if (/\{\{[^}]+\}\}/.test(command)) {
    throw err(
      "BAD_MCP_STDIO_COMMAND",
      `Unresolved variable in MCP stdio command: ${command}`,
    );
  }

  const rawArgs = mcp.args ?? extension.args;

  const args = normalizeStringArray(rawArgs, "args", variableMap);

  const rawCwd = mcp.cwd ?? extension.cwd;

  const cwd =
    typeof rawCwd === "string" && rawCwd.trim()
      ? interpolate(rawCwd, variableMap)
      : undefined;

  if (cwd && /\{\{[^}]+\}\}/.test(cwd)) {
    throw err(
      "BAD_MCP_STDIO_CWD",
      `Unresolved variable in MCP stdio cwd: ${cwd}`,
    );
  }

  const rawEnv = mcp.env ?? extension.env;

  const env = normalizeEnv(rawEnv, variableMap);

  const timeoutMs = normalizePositiveNumber(
    mcp.timeoutMs ?? extension.timeoutMs,
    "timeoutMs",
  );

  const maxBufferBytes = normalizePositiveNumber(
    mcp.maxBufferBytes ?? extension.maxBufferBytes,
    "maxBufferBytes",
  );

  return {
    command,
    ...(args ? { args } : {}),
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxBufferBytes !== undefined ? { maxBufferBytes } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* stdio helpers                                                              */
/* -------------------------------------------------------------------------- */

function normalizeStringArray(
  value: unknown,
  field: string,
  variableMap: Record<string, string>,
): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw err(
      "BAD_MCP_STDIO_CONFIG",
      `MCP stdio ${field} must be an array of strings.`,
    );
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw err(
        "BAD_MCP_STDIO_CONFIG",
        `MCP stdio ${field}[${index}] must be a string.`,
      );
    }

    const resolved = interpolate(item, variableMap);

    if (/\{\{[^}]+\}\}/.test(resolved)) {
      throw err(
        "BAD_MCP_STDIO_CONFIG",
        `Unresolved variable in MCP stdio ${field}[${index}]: ${resolved}`,
      );
    }

    return resolved;
  });
}

function normalizeEnv(
  value: unknown,
  variableMap: Record<string, string>,
): Record<string, string | undefined> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw err("BAD_MCP_STDIO_CONFIG", "MCP stdio env must be an object.");
  }

  const env: Record<string, string | undefined> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }

    if (rawValue === undefined || rawValue === null) {
      env[key] = undefined;
      continue;
    }

    const resolved = interpolate(String(rawValue), variableMap);

    if (/\{\{[^}]+\}\}/.test(resolved)) {
      throw err(
        "BAD_MCP_STDIO_CONFIG",
        `Unresolved variable in MCP stdio env.${key}`,
      );
    }

    env[key] = resolved;
  }

  return env;
}

function normalizePositiveNumber(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw err(
      "BAD_MCP_STDIO_CONFIG",
      `MCP stdio ${field} must be a positive finite number.`,
    );
  }

  return value;
}


function normalizeClientInfo(value: unknown): { name: string; version: string } {
  if (value === undefined || value === null) {
    return { name: "protokit", version: "0.1.0" };
  }
  if (!isPlainObject(value) || typeof value.name !== "string" || !value.name.trim() || typeof value.version !== "string" || !value.version.trim()) {
    throw err(
      "BAD_MCP_CLIENT_INFO",
      "MCP clientInfo must contain non-empty string name and version.",
    );
  }
  return { name: value.name, version: value.version };
}

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

/**
 * Case-insensitive on both sides,
 * so callers may pass any header casing.
 */
function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();

  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}
