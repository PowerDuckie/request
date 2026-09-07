import type { ExecResult, ReplayRecord, SendOptions } from "../../core/types";
import type { ExecuteContext } from "../../core/protocol";
import { toErrorInfo } from "../../core/errors";
import { sendJsonRpc, nextRequestId, isJsonRpcError } from "./jsonrpc";
import { initializeSession } from "./discovery";
import type { ResolvedMcpConfig } from "./config";

/**
 * Run one MCP call.
 *
 * Every call is preceded by its own `initialize` handshake unless the caller
 * supplies a `sessionId` to reuse — MCP sessions are stateful, but this
 * toolkit models one `send()` as one self-contained sample, the same way the
 * gRPC adapter dials fresh per plan and the WebSocket adapter opens and
 * closes one socket per call. The handshake is recorded under `replays` so
 * it stays visible without being mistaken for the operation itself.
 */
export async function runMcp(
  config: ResolvedMcpConfig,
  options: SendOptions,
  ctx?: ExecuteContext,
): Promise<ExecResult> {
  const startedAt = Date.now();
  const signal = ctx?.signal ?? options.signal;
  const replays: ReplayRecord[] = [];

  let sessionId = config.sessionId;
  // Never guess a version we did not negotiate: when a caller reuses an
  // external session without telling us the version, omit the header and let
  // the server apply its own default.
  let protocolVersion: string | undefined = config.protocolVersion;

  if (!sessionId) {
    try {
      const session = await initializeSession(config.endpoint, {
        headers: config.headers,
        signal,
        clientInfo: config.clientInfo,
      });
      sessionId = session.sessionId;
      protocolVersion = session.protocolVersion;
      replays.push({
        url: config.endpoint,
        method: "initialize",
        status: 200,
        reason: "mcp-handshake",
      });
    } catch (e) {
      const endedAt = Date.now();
      return {
        protocol: "mcp",
        request: {
          method: "POST",
          url: config.endpoint,
          headers: config.headers,
          body: { method: "initialize" },
        },
        response: {
          status: 0,
          statusText: "Handshake failed",
          headers: {},
          timings: { startedAt, endedAt, durationMs: endedAt - startedAt },
          sizeBytes: 0,
        },
        error: toErrorInfo(e),
        replays,
      };
    }
  }

  const headers = {
    ...config.headers,
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
  };
  const requestId = nextRequestId();
  const requestBody = {
    jsonrpc: "2.0" as const,
    id: requestId,
    method: config.method,
    params: config.params,
  };

  let outcome: Awaited<ReturnType<typeof sendJsonRpc>>;
  try {
    outcome = await sendJsonRpc(config.endpoint, requestBody, {
      headers,
      signal,
      startedAt,
      protocolVersion,
    });
  } catch (e) {
    const endedAt = Date.now();
    return {
      protocol: "mcp",
      request: {
        method: "POST",
        url: config.endpoint,
        headers,
        body: requestBody,
      },
      response: {
        status: 0,
        statusText: "Request failed",
        headers: {},
        timings: { startedAt, endedAt, durationMs: endedAt - startedAt },
        sizeBytes: 0,
      },
      error: toErrorInfo(e),
      replays,
    };
  }

  const endedAt = Date.now();
  const rpcError = isJsonRpcError(outcome.message)
    ? outcome.message.error
    : undefined;
  const body = rpcError ? undefined : outcome.message?.result;

  return {
    protocol: "mcp",
    request: {
      method: "POST",
      url: config.endpoint,
      headers,
      body: requestBody,
    },
    response: {
      status: outcome.status,
      statusText: outcome.statusText,
      headers: outcome.headers,
      contentType: outcome.contentType,
      body: body ?? outcome.message,
      text: outcome.rawText,
      timings: {
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        firstByteMs: outcome.firstByteMs,
      },
      sizeBytes: outcome.sizeBytes,
    },
    ...(rpcError
      ? { error: { message: rpcError.message, code: String(rpcError.code) } }
      : outcome.message === undefined && outcome.status >= 400
        ? {
            error: {
              message: `MCP endpoint responded HTTP ${outcome.status}`,
              code: String(outcome.status),
            },
          }
        : {}),
    replays,
  };
}
