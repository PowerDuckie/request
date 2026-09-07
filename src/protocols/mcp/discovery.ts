import { err } from "../../core/errors";
import { sendJsonRpc, nextRequestId, isJsonRpcError } from "./jsonrpc";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface McpTool {
  kind: "tool";
  name: string;
  description?: string;
  inputSchema: any;
}

export interface McpResource {
  kind: "resource";
  /** Resource templates use `uriTemplate`; concrete resources use `uri`. */
  uri?: string;
  uriTemplate?: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  kind: "prompt";
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export type McpCapability = McpTool | McpResource | McpPrompt;

export interface McpDiscoveryResult {
  serverInfo?: { name: string; version: string };
  protocolVersion?: string;
  sessionId?: string;
  capabilities: McpCapability[];
  warnings: string[];
}

/**
 * Handshake with an MCP server and establish a session.
 * Every MCP interaction begins here: `initialize` negotiates the protocol
 * version and capabilities, and the client must follow up with the
 * `notifications/initialized` notification before issuing any other call.
 */
export async function initializeSession(
  endpoint: string,
  init: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    clientInfo?: { name: string; version: string };
  } = {},
): Promise<{ sessionId?: string; serverInfo?: { name: string; version: string }; protocolVersion?: string }> {
  const startedAt = Date.now();
  const outcome = await sendJsonRpc(
    endpoint,
    {
      jsonrpc: "2.0",
      id: nextRequestId(),
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: init.clientInfo ?? { name: "protokit", version: "0.1.0" },
      },
    },
    { headers: init.headers, signal: init.signal, startedAt },
  );

  if (isJsonRpcError(outcome.message)) {
    throw err("MCP_INITIALIZE_FAILED", `initialize failed: ${outcome.message.error.message}`, outcome.message.error);
  }
  if (!outcome.message?.result) {
    throw err(
      "MCP_INITIALIZE_FAILED",
      `initialize returned no result (HTTP ${outcome.status}). The endpoint may not speak MCP.`,
    );
  }

  const sessionId = outcome.sessionId;
  const negotiated = outcome.message.result.protocolVersion as string | undefined;

  // Required follow-up notification; the server does not answer it.
  await sendJsonRpc(
    endpoint,
    { jsonrpc: "2.0", method: "notifications/initialized" } as any,
    {
      headers: { ...(init.headers ?? {}), ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) },
      signal: init.signal,
      startedAt,
      protocolVersion: negotiated,
    },
  );

  return {
    sessionId,
    serverInfo: outcome.message.result.serverInfo,
    protocolVersion: negotiated,
  };
}

async function list(
  endpoint: string,
  method: "tools/list" | "resources/list" | "resources/templates/list" | "prompts/list",
  session: { sessionId?: string; protocolVersion?: string },
  init: { headers?: Record<string, string>; signal?: AbortSignal },
): Promise<any[] | undefined> {
  const startedAt = Date.now();
  const headers = {
    ...(init.headers ?? {}),
    ...(session.sessionId ? { "Mcp-Session-Id": session.sessionId } : {}),
  };
  const items: any[] = [];
  let cursor: string | undefined;

  for (;;) {
    const outcome = await sendJsonRpc(
      endpoint,
      { jsonrpc: "2.0", id: nextRequestId(), method, params: cursor ? { cursor } : {} },
      { headers, signal: init.signal, startedAt, protocolVersion: session.protocolVersion },
    );
    // A method the server doesn't implement (e.g. no resources support) is
    // reported as a JSON-RPC "method not found" error, not a fatal failure.
    if (isJsonRpcError(outcome.message)) return undefined;
    const result = outcome.message?.result;
    if (!result) return items.length ? items : undefined;

    const key = method === "tools/list" ? "tools" : method === "prompts/list" ? "prompts" : "resources";
    if (Array.isArray(result[key])) items.push(...result[key]);
    cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
    if (!cursor) break;
  }
  return items;
}

/**
 * Auto-fetch everything an MCP server exposes: tools, resources, resource
 * templates and prompts. This is the MCP analogue of gRPC's reflection
 * `discover()` and GraphQL's schema introspection — one call that hands back
 * every operation the endpoint can perform.
 */
export async function discoverMcpCapabilities(
  endpoint: string,
  options: { headers?: Record<string, string>; signal?: AbortSignal; clientInfo?: { name: string; version: string } } = {},
): Promise<McpDiscoveryResult> {
  const session = await initializeSession(endpoint, options);
  const warnings: string[] = [];
  const capabilities: McpCapability[] = [];

  const tools = await list(endpoint, "tools/list", session, options);
  if (tools) {
    for (const t of tools) {
      if (!t?.name) continue;
      capabilities.push({ kind: "tool", name: t.name, description: t.description, inputSchema: t.inputSchema ?? {} });
    }
  } else {
    warnings.push("Server does not support tools/list (or exposes no tools).");
  }

  const resources = await list(endpoint, "resources/list", session, options);
  const templates = await list(endpoint, "resources/templates/list", session, options);
  for (const r of [...(resources ?? []), ...(templates ?? [])]) {
    if (!r?.name) continue;
    capabilities.push({ kind: "resource", name: r.name, uri: r.uri, uriTemplate: r.uriTemplate, description: r.description, mimeType: r.mimeType });
  }
  if (!resources && !templates) {
    warnings.push("Server does not support resources/list (or exposes no resources).");
  }

  const prompts = await list(endpoint, "prompts/list", session, options);
  if (prompts) {
    for (const p of prompts) {
      if (!p?.name) continue;
      capabilities.push({ kind: "prompt", name: p.name, description: p.description, arguments: p.arguments });
    }
  } else {
    warnings.push("Server does not support prompts/list (or exposes no prompts).");
  }

  return {
    serverInfo: session.serverInfo,
    protocolVersion: session.protocolVersion,
    sessionId: session.sessionId,
    capabilities,
    warnings,
  };
}
