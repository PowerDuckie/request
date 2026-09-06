import type { SendOptions, WebSocketOptions } from "../../core/types";
import type { LocatedOperation } from "../../openapi/locate";
import { resolveServerUrl } from "../http/environment";
import { interpolate } from "../../core/utils";
import { err } from "../../core/errors";

export interface ResolvedWsConfig {
  url: string;
  subprotocols: string[];
  headers: Record<string, string>;
  send: Array<string | Uint8Array>;
  sendDelayMs: number;
  maxMessages: number;
  maxSessionMs: number;
  idleTimeoutMs: number;
  keepAlive?: { intervalMs: number; payload: string };
  closeCode: number;
  closeReason: string;
  rejectUnauthorized: boolean;
  maxPayloadBytes: number;
  clientOptions: Record<string, unknown>;
}

/** Convert an http(s) origin into its ws(s) equivalent. */
function toWsScheme(url: string): string {
  if (/^wss?:\/\//i.test(url)) return url;
  if (/^https:\/\//i.test(url)) return url.replace(/^https:/i, "wss:");
  if (/^http:\/\//i.test(url)) return url.replace(/^http:/i, "ws:");
  // A protocol-relative or bare host defaults to the secure scheme.
  return `wss://${url.replace(/^\/+/, "")}`;
}

function normalizePayload(entry: unknown): string | Uint8Array | null {
  if (entry == null) return null;
  if (typeof entry === "string") return entry;
  if (entry instanceof Uint8Array) return entry;
  try {
    return JSON.stringify(entry);
  } catch {
    return null;
  }
}

/**
 * Resolve the effective WebSocket configuration.
 *
 * Precedence: options.websocket.url > operation['x-websocket'].url > server URL + path.
 */
export function resolveWsConfig(
  located: LocatedOperation,
  spec: any,
  options: SendOptions,
): ResolvedWsConfig {
  const ws: WebSocketOptions = options.websocket ?? {};
  const extension = located.operation?.["x-websocket"] ?? {};
  const variables: Record<string, string> = { ...(options.variables ?? {}) };

  let url: string;
  if (ws.url) {
    url = ws.url;
  } else if (typeof extension.url === "string" && extension.url) {
    url = extension.url;
  } else {
    const base = toWsScheme(resolveServerUrl(located.servers, options));
    // Substitute path parameters with the values the caller supplied.
    const path = located.path.replace(/\{([^}]+)\}/g, (match, name: string) => {
      const value = options.values?.path?.[name];
      return value == null ? match : encodeURIComponent(String(value));
    });
    url = `${base.replace(/\/+$/, "")}/${path.replace(/^\//, "")}`;
  }
  url = interpolate(url, { baseUrl: "", ...variables });

  // Attach declared query parameters so handshake-time auth keeps working.
  try {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(options.values?.query ?? {})) {
      if (value != null) parsed.searchParams.set(key, String(value));
    }
    if (options.auth?.type === "apikey" && options.auth.in === "query") {
      parsed.searchParams.set(
        options.auth.key ?? "api_key",
        options.auth.value ?? "",
      );
    }
    url = parsed.toString();
  } catch {
    throw err("BAD_WS_URL", `Resolved WebSocket URL is invalid: ${url}`);
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.values?.header ?? {})) {
    if (value != null) headers[key] = String(value);
  }
  for (const [key, value] of Object.entries(extension.headers ?? {})) {
    if (value != null) headers[key] = interpolate(String(value), variables);
  }
  for (const [key, value] of Object.entries(ws.headers ?? {})) {
    if (value != null) headers[key] = interpolate(String(value), variables);
  }

  const auth = options.auth;
  if (
    auth &&
    auth.type !== "none" &&
    !Object.keys(headers).some((k) => k.toLowerCase() === "authorization")
  ) {
    if (auth.type === "bearer") {
      headers.Authorization = `Bearer ${auth.token ?? ""}`;
    } else if (auth.type === "basic") {
      const raw = `${auth.username ?? ""}:${auth.password ?? ""}`;
      headers.Authorization = `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
    } else if (auth.type === "apikey" && (auth.in ?? "header") === "header") {
      headers[auth.key ?? "X-API-Key"] = auth.value ?? "";
    }
  }

  const rawSend = ws.send ?? extension.send ?? [];
  const send = (Array.isArray(rawSend) ? rawSend : [rawSend])
    .map((entry) =>
      normalizePayload(
        typeof entry === "string" ? interpolate(entry, variables) : entry,
      ),
    )
    .filter((entry): entry is string | Uint8Array => entry !== null);

  const keepAliveSource = ws.keepAlive ?? extension.keepAlive;

  return {
    url,
    subprotocols: ws.subprotocols ?? extension.subprotocols ?? [],
    headers,
    send,
    sendDelayMs: clampPositive(ws.sendDelayMs, 0),
    maxMessages: clampPositive(ws.maxMessages ?? options.maxEvents, 100),
    maxSessionMs: clampPositive(ws.maxSessionMs ?? options.maxStreamMs, 30_000),
    idleTimeoutMs: clampPositive(ws.idleTimeoutMs, 0),
    keepAlive: keepAliveSource
      ? {
          intervalMs: clampPositive(keepAliveSource.intervalMs, 15_000),
          payload: String(keepAliveSource.payload ?? "ping"),
        }
      : undefined,
    closeCode: ws.closeCode ?? 1000,
    closeReason: ws.closeReason ?? "Client finished sampling",
    rejectUnauthorized: ws.rejectUnauthorized !== false,
    maxPayloadBytes: clampPositive(ws.maxPayloadBytes, 1024 * 256),
    clientOptions: ws.clientOptions ?? {},
  };
}

function clampPositive(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
}
