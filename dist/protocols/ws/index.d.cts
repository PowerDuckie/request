import { L as LocatedOperation, E as ExecuteContext, P as ProtocolAdapter, A as AdapterContext } from '../../protocol-Dh-wN2nY.cjs';
import { a as SendOptions, al as ResolvedWsConfig, E as ExecResult, k as CreateWsManualSessionOptions, aC as WsManualSession } from '../../types-C9ifzKqk.cjs';
export { az as WebSocketSessionEvent, aA as WebSocketSessionState, aD as WsSendOptions } from '../../types-C9ifzKqk.cjs';

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

export { CreateWsManualSessionOptions, ResolvedWsConfig, WebSocketAdapter, WsManualSession, type WsPlan, createWsManualSession, resolveWsConfig, runWebSocket, createWsManualSession as runWebSocketSession, createWsManualSession as wsManualSession };
