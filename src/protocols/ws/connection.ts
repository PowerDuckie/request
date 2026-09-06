import WebSocket from "ws";
import type {
  SendOptions,
  ExecResult,
  StreamEvent,
  Json,
} from "../../core/types";
import { createLatch, safeClearTimeout } from "../../core/utils";
import { toErrorInfo } from "../../core/errors";
import type { ResolvedWsConfig } from "./config";

/** WebSocket close codes that indicate a clean, expected shutdown. */
const NORMAL_CLOSE_CODES = new Set([1000, 1001, 1005]);

/**
 * Open a WebSocket session, send the configured messages, and collect
 * inbound frames until a sampling limit or a close event is reached.
 */
export function runWebSocket(
  config: ResolvedWsConfig,
  options: SendOptions,
): Promise<ExecResult> {
  const latch = createLatch<ExecResult>();

  const startedAt = Date.now();
  let openedAt: number | undefined;
  let inboundCount = 0;
  let sequence = 0;
  let bytes = 0;
  let truncated = false;
  let closing = false;

  const events: StreamEvent[] = [];
  const handshakeHeaders: Record<string, string> = {};
  let handshakeStatus = 0;
  let negotiatedProtocol: string | undefined;
  let failure: { message: string; code?: string; name?: string } | undefined;

  let sessionTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  const sendTimers: Array<ReturnType<typeof setTimeout>> = [];

  const clearAllTimers = () => {
    sessionTimer = safeClearTimeout(sessionTimer);
    idleTimer = safeClearTimeout(idleTimer);
    if (keepAliveTimer) {
      try {
        clearInterval(keepAliveTimer);
      } catch {
        /* ignore */
      }
      keepAliveTimer = null;
    }
    for (const timer of sendTimers.splice(0)) safeClearTimeout(timer);
  };

  let socket: WebSocket;
  try {
    socket = new WebSocket(config.url, config.subprotocols, {
      headers: config.headers,
      handshakeTimeout: Math.max(5_000, Math.min(config.maxSessionMs, 30_000)),
      rejectUnauthorized: config.rejectUnauthorized,
      maxPayload: config.maxPayloadBytes * 4,
      ...config.clientOptions,
    });
  } catch (e) {
    return Promise.resolve(buildResult(toErrorInfo(e)));
  }

  function buildResult(error?: {
    message: string;
    code?: string;
    name?: string;
  }): ExecResult {
    const endedAt = Date.now();
    const succeeded = !error && handshakeStatus > 0 && handshakeStatus < 400;
    return {
      protocol: "websocket",
      request: {
        method: "GET",
        url: config.url,
        headers: {
          ...config.headers,
          Upgrade: "websocket",
          Connection: "Upgrade",
          ...(config.subprotocols.length
            ? { "Sec-WebSocket-Protocol": config.subprotocols.join(", ") }
            : {}),
        },
        body: config.send.length
          ? config.send.map((entry) =>
              typeof entry === "string"
                ? entry
                : `<binary ${entry.byteLength} bytes>`,
            )
          : undefined,
      },
      response: {
        status: handshakeStatus || (error ? 0 : 101),
        statusText: error
          ? "WebSocket error"
          : succeeded
            ? "Switching Protocols"
            : "Connection closed",
        headers: handshakeHeaders,
        contentType: "application/json",
        events,
        timings: {
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          firstByteMs: openedAt ? openedAt - startedAt : undefined,
        },
        sizeBytes: bytes,
        ...(truncated ? { truncated: true } : {}),
      },
      ...(negotiatedProtocol ? { cookies: [] } : {}),
      ...(error ? { error } : {}),
    };
  }

  const finish = (error?: {
    message: string;
    code?: string;
    name?: string;
  }) => {
    if (latch.settled) return;
    clearAllTimers();
    latch.resolve(buildResult(error ?? failure));
  };

  const closeSocket = (reason: string) => {
    if (closing) return;
    closing = true;
    truncated = true;
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(
          config.closeCode,
          `${config.closeReason}: ${reason}`.slice(0, 120),
        );
      } else {
        socket.terminate();
      }
    } catch {
      /* ignore */
    }
    // The 'close' event may never arrive on a half-open socket.
    const guard = setTimeout(() => {
      try {
        socket.terminate();
      } catch {
        /* ignore */
      }
      finish();
    }, 3_000);
    if (typeof guard === "object" && typeof (guard as any).unref === "function")
      (guard as any).unref();
    sendTimers.push(guard);
  };

  const bumpIdleTimer = () => {
    if (!config.idleTimeoutMs) return;
    idleTimer = safeClearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => closeSocket("idle timeout"),
      config.idleTimeoutMs,
    );
    if (
      typeof idleTimer === "object" &&
      typeof (idleTimer as any).unref === "function"
    ) {
      (idleTimer as any).unref();
    }
  };

  const record = (event: StreamEvent) => {
    events.push(event);
    try {
      options.onEvent?.(event);
    } catch {
      /* User callbacks must not break the session. */
    }
  };

  socket.on("upgrade", (response: any) => {
    handshakeStatus = response?.statusCode ?? 101;
    for (const [key, value] of Object.entries(response?.headers ?? {})) {
      handshakeHeaders[key] = Array.isArray(value)
        ? value.join(", ")
        : String(value);
    }
  });

  socket.on("unexpected-response", (_request: any, response: any) => {
    handshakeStatus = response?.statusCode ?? 0;
    for (const [key, value] of Object.entries(response?.headers ?? {})) {
      handshakeHeaders[key] = Array.isArray(value)
        ? value.join(", ")
        : String(value);
    }
    failure = {
      message: `Handshake rejected with HTTP ${handshakeStatus}`,
      code: "WS_HANDSHAKE_FAILED",
    };
    try {
      response?.destroy?.();
    } catch {
      /* ignore */
    }
    finish(failure);
  });

  socket.on("open", () => {
    openedAt = Date.now();
    negotiatedProtocol = socket.protocol || undefined;
    if (!handshakeStatus) handshakeStatus = 101;

    try {
      options.onOpen?.({
        url: config.url,
        protocol: negotiatedProtocol,
        headers: handshakeHeaders,
      });
    } catch {
      /* ignore */
    }

    // Outbound messages, optionally spaced out to mimic a real client.
    config.send.forEach((payload, index) => {
      const dispatch = () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(payload, (sendError?: Error) => {
          if (sendError) {
            failure = failure ?? toErrorInfo(sendError);
            return;
          }
          sequence += 1;
          record({
            id: String(sequence),
            event: typeof payload === "string" ? "text" : "binary",
            data:
              typeof payload === "string"
                ? payload
                : `<binary ${payload.byteLength} bytes>`,
            parsed: typeof payload === "string" ? tryParse(payload) : undefined,
            receivedAt: Date.now(),
            direction: "out",
          });
        });
      };
      const delay = config.sendDelayMs * index;
      if (delay <= 0) {
        dispatch();
      } else {
        const timer = setTimeout(dispatch, delay);
        if (
          typeof timer === "object" &&
          typeof (timer as any).unref === "function"
        )
          (timer as any).unref();
        sendTimers.push(timer);
      }
    });

    if (config.keepAlive) {
      keepAliveTimer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        try {
          socket.ping(config.keepAlive!.payload);
        } catch {
          /* ignore */
        }
      }, config.keepAlive.intervalMs);
      if (
        typeof keepAliveTimer === "object" &&
        typeof (keepAliveTimer as any).unref === "function"
      ) {
        (keepAliveTimer as any).unref();
      }
    }

    bumpIdleTimer();
  });

  socket.on("message", (raw: WebSocket.RawData, isBinary: boolean) => {
    if (closing) return;

    const buffer = toBuffer(raw);
    bytes += buffer.length;
    sequence += 1;
    inboundCount += 1;

    const oversized = buffer.length > config.maxPayloadBytes;
    const text = isBinary
      ? `<binary ${buffer.length} bytes>`
      : oversized
        ? `${buffer.subarray(0, config.maxPayloadBytes).toString("utf8")}...`
        : buffer.toString("utf8");

    record({
      id: String(sequence),
      event: isBinary ? "binary" : "text",
      data: text,
      parsed: !isBinary && !oversized ? tryParse(text) : undefined,
      receivedAt: Date.now(),
      direction: "in",
    });

    bumpIdleTimer();

    if (inboundCount >= config.maxMessages) closeSocket("maxMessages reached");
  });

  socket.on("ping", (payload: Buffer) => {
    sequence += 1;
    record({
      id: String(sequence),
      event: "ping",
      data: payload?.length ? payload.toString("utf8") : "",
      receivedAt: Date.now(),
      direction: "in",
    });
    bumpIdleTimer();
  });

  socket.on("error", (socketError: Error) => {
    failure = failure ?? toErrorInfo(socketError);
    // Let 'close' finalize when it follows; otherwise settle here.
    if (socket.readyState === WebSocket.CLOSED) finish(failure);
  });

  socket.on("close", (code: number, reasonBuffer: Buffer) => {
    const reason = reasonBuffer?.length ? reasonBuffer.toString("utf8") : "";
    if (!failure && !NORMAL_CLOSE_CODES.has(code) && !closing) {
      failure = {
        message: `Connection closed with code ${code}${reason ? `: ${reason}` : ""}`,
        code: String(code),
      };
    }
    finish(failure);
  });

  sessionTimer = setTimeout(
    () => closeSocket("maxSessionMs reached"),
    config.maxSessionMs,
  );
  if (
    typeof sessionTimer === "object" &&
    typeof (sessionTimer as any).unref === "function"
  ) {
    (sessionTimer as any).unref();
  }

  return latch.promise;
}

function toBuffer(raw: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw as ArrayBuffer);
}

function tryParse(text: string): Json | undefined {
  const trimmed = text.trim();
  if (!trimmed || !/^[[{"\-\d]|^(true|false|null)$/.test(trimmed))
    return undefined;
  try {
    return JSON.parse(trimmed) as Json;
  } catch {
    return undefined;
  }
}
