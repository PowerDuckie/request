import type {
  ProtocolAdapter,
  AdapterContext,
  ExecuteContext,
} from "../../core/protocol";
import type { SendOptions, ExecResult } from "../../core/types";
import { resolveWsConfig, type ResolvedWsConfig } from "./config";
import { runWebSocket } from "./connection";

export interface WsPlan {
  config: ResolvedWsConfig;
  /** Environment document mirroring the HTTP adapter's output shape. */
  environment: Record<string, any>;
}

/** Same detection as the HTTP environment builder uses. */
const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|apikey|api_key|credential|private)/i;

/**
 * WebSocket adapter.
 *
 * An operation is claimed when it declares `x-protocol: websocket`,
 * carries an `x-websocket` extension, or the caller passes `websocket.url`.
 */
export class WebSocketAdapter implements ProtocolAdapter<WsPlan> {
  readonly name = "websocket";

  supports(ctx: AdapterContext): number {
    const operation = ctx.located.operation ?? {};
    if (
      operation["x-protocol"] === "websocket" ||
      operation["x-protocol"] === "ws"
    )
      return 20;
    if (
      operation["x-websocket"] &&
      typeof operation["x-websocket"] === "object"
    )
      return 15;
    if (ctx.options.websocket?.url) return 15;
    // A path-level upgrade hint is a weaker but still decisive signal.
    if (ctx.located.pathItem?.["x-protocol"] === "websocket") return 12;
    return 0;
  }

  plan(ctx: AdapterContext): WsPlan {
    const config = resolveWsConfig(ctx.located, ctx.spec, ctx.options);
    const values = [
      { key: "wsUrl", value: config.url, type: "default", enabled: true },
      ...Object.entries(ctx.options.variables ?? {})
        .filter(([key]) => key !== "wsUrl")
        .map(([key, value]) => ({
          key,
          value: value == null ? "" : String(value),
          type: SECRET_KEY_PATTERN.test(key) ? "secret" : "default",
          enabled: true,
        })),
    ];

    return {
      config,
      environment: {
        // Two random-free components, matching the HTTP builder, so two
        // environments created in the same millisecond still differ.
        id: `protokit-ws-env-${Date.now().toString(36)}-${(
          (Math.random() * 0xffffff) |
          0
        ).toString(36)}`,
        name: `${ctx.spec?.info?.title ?? "API"} WebSocket Environment`,
        values,
        _postman_variable_scope: "environment",
        _postman_exported_at: new Date().toISOString(),
      },
    };
  }

  execute(
    plan: WsPlan,
    options: SendOptions,
    ctx?: ExecuteContext,
  ): Promise<ExecResult> {
    return runWebSocket(plan.config, options, ctx);
  }
}

export { resolveWsConfig } from "./config";
export { runWebSocket } from "./connection";
export type { ResolvedWsConfig } from "./config";
