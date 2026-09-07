
import { initializeSession } from "./discovery.js";
import { sendJsonRpc, nextRequestId } from "./jsonrpc.js";

export function runMcpManualSession(config: {
  endpoint: string;
  headers?: Record<string,string>;
  clientInfo?: { name: string; version: string };
}) {
  const events:any[] = [];
  let state:"connecting"|"open"|"closing"|"closed"="connecting";
  let sessionId: string | undefined;
  let protocolVersion: string | undefined;
  return {
    get events(){ return events; },
    get state(){ return state; },
    get sessionId(){ return sessionId; },
    async open() {
      if (state !== "connecting") return;
      const s = await initializeSession(config.endpoint, { headers: config.headers, clientInfo: config.clientInfo });
      sessionId = s.sessionId;
      protocolVersion = s.protocolVersion;
      state = "open";
      events.push({ direction:"in", receivedAt:Date.now(), event:"session", data: JSON.stringify({ sessionId, protocolVersion }), parsed:{ sessionId, protocolVersion } });
    },
    async send(message: unknown, options?: { delayMs?: number }) {
      if (options?.delayMs) await new Promise(r=>setTimeout(r, options.delayMs));
      const payload = typeof message === "object" && message ? message as any : { method: String(message) };
      const body = { jsonrpc:"2.0", id: nextRequestId(), ...payload };
      events.push({ direction:"out", receivedAt:Date.now(), event:"jsonrpc", data: JSON.stringify(body), parsed: body });
      const outcome = await sendJsonRpc(config.endpoint, body as any, {
        headers: { ...(config.headers ?? {}), ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) },
        startedAt: Date.now(),
        protocolVersion,
      });
      events.push({ direction:"in", receivedAt:Date.now(), event:"jsonrpc", data: JSON.stringify(outcome.message), parsed: outcome.message });
      return outcome;
    },
    async close() { state="closed"; },
    async waitForClose() { return; },
  };
}
