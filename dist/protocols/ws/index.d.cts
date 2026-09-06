import { L as LocatedOperation, a as SendOptions, E as ExecResult, P as ProtocolAdapter, A as AdapterContext } from '../../protocol-58EyJAsY.cjs';

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
 * Open a WebSocket session, send the configured messages, and collect
 * inbound frames until a sampling limit or a close event is reached.
 */
declare function runWebSocket(config: ResolvedWsConfig, options: SendOptions): Promise<ExecResult>;

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
    execute(plan: WsPlan, options: SendOptions): Promise<ExecResult>;
}

export { type ResolvedWsConfig, WebSocketAdapter, type WsPlan, resolveWsConfig, runWebSocket };
