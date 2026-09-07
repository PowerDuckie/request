import WebSocket, { type ClientOptions, type Data, type RawData } from "ws";

export type WebSocketSessionState =
  | "idle"
  | "connecting"
  | "open"
  | "closing"
  | "closed"
  | "error";

export interface WebSocketSessionEvent {
  direction: "in" | "out" | "meta";
  receivedAt: number;
  event:
    | "open"
    | "text"
    | "binary"
    | "error"
    | "close"
    | "upgrade"
    | "unexpected-response";
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

export interface CreateWsManualSessionOptions {
  url: string;
  headers?: Record<string, string>;
  subprotocols?: string[];
  rejectUnauthorized?: boolean;
  /** Abort opening / pending operations from the outside. */
  signal?: AbortSignal;
  /** Handshake timeout in ms. Default 15_000. */
  openTimeoutMs?: number;
  /** Ring-buffer cap for events. 0 = unbounded. Default 1000. */
  maxEvents?: number;
}

export interface WsSendOptions {
  delayMs?: number;
  binary?: boolean;
}

export interface WsManualSession {
  readonly state: WebSocketSessionState;
  readonly events: readonly WebSocketSessionEvent[];

  open(): Promise<void>;

  send(data: unknown, options?: WsSendOptions): Promise<void>;

  close(options?: { code?: number; reason?: string }): Promise<void>;

  waitForClose(): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function normalizeBinaryData(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (typeof data === "string") {
    return Buffer.from(data, "base64");
  }

  throw new TypeError(
    "Binary WebSocket data must be a Buffer, Uint8Array, ArrayBuffer, or base64 string",
  );
}

export function createWsManualSession(
  options: CreateWsManualSessionOptions,
): WsManualSession {
  let state: WebSocketSessionState = "idle";
  const events: WebSocketSessionEvent[] = [];
  const maxEvents =
    typeof options.maxEvents === "number" && options.maxEvents >= 0
      ? Math.floor(options.maxEvents)
      : 1000;
  const openTimeoutMs =
    typeof options.openTimeoutMs === "number" && options.openTimeoutMs > 0
      ? Math.floor(options.openTimeoutMs)
      : 15_000;

  let socket: WebSocket | null = null;

  let closeResolve: () => void = () => {};
  let closePromise: Promise<void> = createClosePromise();

  function createClosePromise(): Promise<void> {
    return new Promise<void>((resolve) => {
      closeResolve = resolve;
    });
  }

  function resetClosePromise(): void {
    closePromise = createClosePromise();
  }

  function record(event: WebSocketSessionEvent): void {
    events.push(event);
    if (maxEvents > 0 && events.length > maxEvents) {
      events.splice(0, events.length - maxEvents);
    }
  }

  function assertSocketOpen(): WebSocket {
    if (!socket || state !== "open" || socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket session is not open");
    }

    return socket;
  }

  function recordError(error: unknown): void {
    const message = errorMessage(error);

    record({
      direction: "meta",
      receivedAt: Date.now(),
      event: "error",
      data: message,
      error: message,
    });
  }

  return {
    get state(): WebSocketSessionState {
      return state;
    },

    get events(): readonly WebSocketSessionEvent[] {
      return events;
    },

    async open(): Promise<void> {
      if (state !== "idle" && state !== "closed" && state !== "error") {
        throw new Error(`WebSocket session cannot open from state "${state}"`);
      }

      if (options.signal?.aborted) {
        state = "closed";
        throw new Error("WebSocket open aborted");
      }

      if (!options.url?.trim()) {
        throw new Error("WebSocket URL is required");
      }

      resetClosePromise();
      state = "connecting";

      await new Promise<void>((resolve, reject) => {
        const clientOptions: ClientOptions = {
          headers: options.headers,
        };

        if (options.rejectUnauthorized !== undefined) {
          clientOptions.rejectUnauthorized = options.rejectUnauthorized;
        }

        const protocols = options.subprotocols?.filter(Boolean) ?? [];

        const ws =
          protocols.length > 0
            ? new WebSocket(options.url, protocols, clientOptions)
            : new WebSocket(options.url, clientOptions);

        socket = ws;

        let openSettled = false;
        let unexpectedResponseReceived = false;
        let openTimeout: ReturnType<typeof setTimeout> | undefined;
        let detachAbort: (() => void) | undefined;

        const cleanupOpenGuards = (): void => {
          if (openTimeout) {
            clearTimeout(openTimeout);
            openTimeout = undefined;
          }
          detachAbort?.();
          detachAbort = undefined;
        };

        const rejectOpen = (error: Error): void => {
          if (openSettled) {
            return;
          }

          openSettled = true;
          cleanupOpenGuards();
          reject(error);
        };

        const resolveOpen = (): void => {
          if (openSettled) {
            return;
          }

          openSettled = true;
          cleanupOpenGuards();
          resolve();
        };

        openTimeout = setTimeout(() => {
          const error = new Error(
            `WebSocket handshake timed out after ${openTimeoutMs}ms`,
          );
          state = "error";
          recordError(error);
          rejectOpen(error);
          try {
            ws.terminate();
          } catch {
            // ignore
          }
        }, openTimeoutMs);

        if (typeof (openTimeout as any)?.unref === "function") {
          (openTimeout as any).unref();
        }

        if (options.signal) {
          const onAbort = () => {
            const error = new Error("WebSocket open aborted");
            state = "closed";
            recordError(error);
            rejectOpen(error);
            try {
              ws.terminate();
            } catch {
              // ignore
            }
            closeResolve();
          };

          if (options.signal.aborted) {
            onAbort();
            return;
          }

          options.signal.addEventListener("abort", onAbort, { once: true });
          detachAbort = () =>
            options.signal?.removeEventListener("abort", onAbort);
        }

        ws.once("upgrade", (response) => {
          record({
            direction: "meta",
            receivedAt: Date.now(),
            event: "upgrade",
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            headers: response.headers,
          });
        });

        ws.once("unexpected-response", (_request, response) => {
          unexpectedResponseReceived = true;

          record({
            direction: "meta",
            receivedAt: Date.now(),
            event: "unexpected-response",
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            headers: response.headers,
          });

          response.resume();

          const statusText = [response.statusCode, response.statusMessage]
            .filter(
              (value): value is number | string =>
                value !== undefined && value !== "",
            )
            .join(" ");

          const error = new Error(
            `WebSocket handshake failed${statusText ? `: ${statusText}` : ""}`,
          );

          state = "error";
          recordError(error);
          rejectOpen(error);

          if (
            ws.readyState === WebSocket.CONNECTING ||
            ws.readyState === WebSocket.OPEN
          ) {
            ws.terminate();
          }
        });

        ws.once("open", () => {
          state = "open";

          record({
            direction: "meta",
            receivedAt: Date.now(),
            event: "open",
            statusCode: 101,
            statusMessage: "Switching Protocols",
            protocol: ws.protocol || undefined,
            extensions: ws.extensions || undefined,
          });

          resolveOpen();
        });

        ws.on("message", (data: RawData, isBinary: boolean) => {
          if (isBinary) {
            const buffer = Buffer.isBuffer(data)
              ? data
              : Array.isArray(data)
                ? Buffer.concat(data)
                : data instanceof ArrayBuffer
                  ? Buffer.from(data)
                  : Buffer.from(data);

            record({
              direction: "in",
              receivedAt: Date.now(),
              event: "binary",
              data: buffer.toString("base64"),
            });

            return;
          }

          const text = Buffer.isBuffer(data)
            ? data.toString("utf8")
            : Array.isArray(data)
              ? Buffer.concat(data).toString("utf8")
              : data instanceof ArrayBuffer
                ? Buffer.from(data).toString("utf8")
                : Buffer.from(data).toString("utf8");

          record({
            direction: "in",
            receivedAt: Date.now(),
            event: "text",
            data: text,
            parsed: tryParseJson(text),
          });
        });

        ws.on("error", (error) => {
          state = "error";
          recordError(error);
          rejectOpen(error);
        });

        ws.once("close", (code, reasonBuffer) => {
          const reason = reasonBuffer.toString("utf8");
          const wasClean = code === 1000;

          state = "closed";

          record({
            direction: "meta",
            receivedAt: Date.now(),
            event: "close",
            code,
            reason,
            wasClean,
          });

          closeResolve();

          if (!openSettled && !unexpectedResponseReceived) {
            rejectOpen(
              new Error(
                `WebSocket closed before opening: ${code}${
                  reason ? ` ${reason}` : ""
                }`,
              ),
            );
          }
        });
      });
    },

    async send(data: unknown, sendOptions: WsSendOptions = {}): Promise<void> {
      if (options.signal?.aborted) {
        throw new Error("WebSocket send aborted");
      }

      const ws = assertSocketOpen();

      if (sendOptions.delayMs !== undefined && sendOptions.delayMs > 0) {
        await delay(sendOptions.delayMs);
      }

      if (options.signal?.aborted) {
        throw new Error("WebSocket send aborted");
      }

      assertSocketOpen();

      let outboundData: Data;
      let eventType: "text" | "binary";
      let displayData: string;
      let parsed: unknown;

      if (
        sendOptions.binary ||
        Buffer.isBuffer(data) ||
        data instanceof Uint8Array ||
        data instanceof ArrayBuffer
      ) {
        const buffer = normalizeBinaryData(data);

        outboundData = buffer;
        eventType = "binary";
        displayData = buffer.toString("base64");
      } else if (typeof data === "string") {
        outboundData = data;
        eventType = "text";
        displayData = data;
        parsed = tryParseJson(data);
      } else {
        const serialized = JSON.stringify(data);

        if (serialized === undefined) {
          throw new TypeError("WebSocket payload cannot be serialized");
        }

        outboundData = serialized;
        eventType = "text";
        displayData = serialized;
        parsed = data;
      }

      await new Promise<void>((resolve, reject) => {
        ws.send(
          outboundData,
          {
            binary: eventType === "binary",
          },
          (error?: Error) => {
            if (error) {
              recordError(error);
              reject(error);
              return;
            }

            record({
              direction: "out",
              receivedAt: Date.now(),
              event: eventType,
              data: displayData,
              parsed,
            });

            resolve();
          },
        );
      });
    },

    async close(
      closeOptions: {
        code?: number;
        reason?: string;
      } = {},
    ): Promise<void> {
      if (!socket) {
        state = "closed";
        closeResolve();
        return;
      }

      if (state === "closed") {
        closeResolve();
        return;
      }

      if (state === "closing") {
        return;
      }

      state = "closing";

      if (socket.readyState === WebSocket.CONNECTING) {
        socket.terminate();
        return;
      }

      if (socket.readyState === WebSocket.OPEN) {
        socket.close(
          closeOptions.code ?? 1000,
          closeOptions.reason ?? "Closed",
        );
        return;
      }

      if (socket.readyState === WebSocket.CLOSING) {
        return;
      }

      state = "closed";
      closeResolve();
    },

    async waitForClose(): Promise<void> {
      await closePromise;
    },
  };
}

export const wsManualSession = createWsManualSession;
