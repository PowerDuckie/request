import { L as LocatedOperation, b as SendOptions, f as ExecuteContext, E as ExecResult, P as ProtocolAdapter, A as AdapterContext } from '../../protocol-xeNbDlvO.js';

interface ResolvedWsConfig {
    url: string;
    subprotocols: string[];
    headers: Record<string, string>;
    send: Array<string | Uint8Array>;
    sendDelayMs: number;
    maxMessages: number;
    maxSessionMs: number;
    idleTimeoutMs: number;
    keepAlive?: {
        intervalMs: number;
        payload: string;
    };
    closeCode: number;
    closeReason: string;
    /** Grace period for the peer's close frame before the socket is destroyed. */
    closeTimeoutMs: number;
    rejectUnauthorized: boolean;
    maxPayloadBytes: number;
    clientOptions: Record<string, unknown>;
}
/**
 * Resolve the effective WebSocket configuration.
 *
 * Precedence: options.websocket.url > operation['x-websocket'].url > server URL + path.
 */
declare function resolveWsConfig(located: LocatedOperation, spec: any, options: SendOptions): ResolvedWsConfig;

/**
 * Open a WebSocket session, send the configured messages, and collect inbound
 * frames until a sampling limit or a close event is reached.
 *
 * Lifecycle: connecting -> open -> closing -> finalized. Every exit path runs
 * through `finalize()`, which is idempotent, so a close frame racing the close
 * watchdog cannot produce two results.
 */
declare function runWebSocket(config: ResolvedWsConfig, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;

interface WsPlan {
    config: ResolvedWsConfig;
    /** Environment document mirroring the HTTP adapter's output shape. */
    environment: Record<string, any>;
}
/**
 * WebSocket adapter.
 *
 * An operation is claimed when it declares `x-protocol: websocket`,
 * carries an `x-websocket` extension, or the caller passes `websocket.url`.
 */
declare class WebSocketAdapter implements ProtocolAdapter<WsPlan> {
    readonly name = "websocket";
    supports(ctx: AdapterContext): number;
    plan(ctx: AdapterContext): WsPlan;
    execute(plan: WsPlan, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;
}

export { type ResolvedWsConfig, WebSocketAdapter, type WsPlan, resolveWsConfig, runWebSocket };
