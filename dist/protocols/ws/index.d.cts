import { L as LocatedOperation, a as SendOptions, b as ExecuteContext, E as ExecResult, P as ProtocolAdapter, A as AdapterContext } from '../../protocol-C1fL6J7c.cjs';

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

type WebSocketSessionState = "idle" | "connecting" | "open" | "closing" | "closed" | "error";
interface WebSocketSessionEvent {
    direction: "in" | "out" | "meta";
    receivedAt: number;
    event: "open" | "text" | "binary" | "error" | "close" | "upgrade" | "unexpected-response";
    data?: string;
    parsed?: unknown;
    code?: number;
    reason?: string;
    protocol?: string;
    extensions?: string;
    wasClean?: boolean;
    statusCode?: number;
    statusMessage?: string;
    headers?: Record<string, string | string[] | undefined>;
    error?: string;
}
interface CreateWsManualSessionOptions {
    url: string;
    headers?: Record<string, string>;
    subprotocols?: string[];
    rejectUnauthorized?: boolean;
}
interface WsSendOptions {
    delayMs?: number;
    binary?: boolean;
}
interface WsManualSession {
    readonly state: WebSocketSessionState;
    readonly events: WebSocketSessionEvent[];
    open(): Promise<void>;
    send(data: unknown, options?: WsSendOptions): Promise<void>;
    close(options?: {
        code?: number;
        reason?: string;
    }): Promise<void>;
    waitForClose(): Promise<void>;
}
declare function createWsManualSession(options: CreateWsManualSessionOptions): WsManualSession;

interface WsPlan {
    config: ResolvedWsConfig;
    environment: Record<string, any>;
}
declare class WebSocketAdapter implements ProtocolAdapter<WsPlan> {
    readonly name = "websocket";
    supports(ctx: AdapterContext): number;
    plan(ctx: AdapterContext): WsPlan;
    execute(plan: WsPlan, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;
}

export { type CreateWsManualSessionOptions, type ResolvedWsConfig, WebSocketAdapter, type WebSocketSessionEvent, type WebSocketSessionState, type WsManualSession, type WsPlan, type WsSendOptions, createWsManualSession, resolveWsConfig, runWebSocket, createWsManualSession as runWebSocketSession, createWsManualSession as wsManualSession };
