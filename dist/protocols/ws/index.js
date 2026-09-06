// src/protocols/http/environment.ts
function resolveServerUrl(servers, options) {
  if (options.serverUrl) return stripTrailingSlash(options.serverUrl);
  const server = Array.isArray(servers) && servers.length ? servers[0] : { url: "/" };
  let url = typeof server?.url === "string" && server.url ? server.url : "/";
  const variables = server?.variables && typeof server.variables === "object" ? server.variables : {};
  for (const [name, definition] of Object.entries(variables)) {
    const override = options.serverVariables?.[name];
    const fallback = definition?.default ?? (Array.isArray(definition?.enum) && definition.enum.length ? definition.enum[0] : "");
    const value = override !== void 0 ? override : fallback;
    url = url.split(`{${name}}`).join(String(value ?? ""));
  }
  url = url.replace(/\{[^}]*\}/g, "");
  return stripTrailingSlash(url);
}
function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "") || url;
}

// src/core/utils.ts
function interpolate(input, vars) {
  const source = input == null ? "" : String(input);
  if (source.indexOf("{{") === -1) return source;
  return source.replace(
    /\{\{\s*([\w.$-]+)\s*\}\}/g,
    (match, key) => Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
}
function createLatch() {
  let settled = false;
  let resolveFn;
  let rejectFn;
  const promise = new Promise((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value) {
      if (settled) return;
      settled = true;
      resolveFn(value);
    },
    reject(reason) {
      if (settled) return;
      settled = true;
      rejectFn(reason);
    }
  };
}
function safeClearTimeout(timer) {
  if (timer) {
    try {
      clearTimeout(timer);
    } catch {
    }
  }
  return null;
}

// src/core/errors.ts
var ProtoKitError = class _ProtoKitError extends Error {
  code;
  details;
  constructor(message, code, details) {
    super(message);
    this.name = "ProtoKitError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, _ProtoKitError.prototype);
    if (Error.captureStackTrace) Error.captureStackTrace(this, _ProtoKitError);
  }
};
function err(code, message, details) {
  return new ProtoKitError(message, code, details);
}
function toErrorInfo(e) {
  if (e instanceof ProtoKitError)
    return { message: e.message, code: e.code, name: e.name };
  if (e instanceof Error)
    return { message: e.message, code: e.code, name: e.name };
  if (typeof e === "string") return { message: e };
  try {
    return { message: JSON.stringify(e) };
  } catch {
    return { message: String(e) };
  }
}

// src/protocols/ws/config.ts
function toWsScheme(url) {
  if (/^wss?:\/\//i.test(url)) return url;
  if (/^https:\/\//i.test(url)) return url.replace(/^https:/i, "wss:");
  if (/^http:\/\//i.test(url)) return url.replace(/^http:/i, "ws:");
  return `wss://${url.replace(/^\/+/, "")}`;
}
function normalizePayload(entry) {
  if (entry == null) return null;
  if (typeof entry === "string") return entry;
  if (entry instanceof Uint8Array) return entry;
  try {
    return JSON.stringify(entry);
  } catch {
    return null;
  }
}
function resolveWsConfig(located, spec, options) {
  const ws = options.websocket ?? {};
  const extension = located.operation?.["x-websocket"] ?? {};
  const variables = { ...options.variables ?? {} };
  let url;
  if (ws.url) {
    url = ws.url;
  } else if (typeof extension.url === "string" && extension.url) {
    url = extension.url;
  } else {
    const base = toWsScheme(resolveServerUrl(located.servers, options));
    const path = located.path.replace(/\{([^}]+)\}/g, (match, name) => {
      const value = options.values?.path?.[name];
      return value == null ? match : encodeURIComponent(String(value));
    });
    url = `${base.replace(/\/+$/, "")}/${path.replace(/^\//, "")}`;
  }
  url = interpolate(url, { baseUrl: "", ...variables });
  try {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(options.values?.query ?? {})) {
      if (value != null) parsed.searchParams.set(key, String(value));
    }
    if (options.auth?.type === "apikey" && options.auth.in === "query") {
      parsed.searchParams.set(
        options.auth.key ?? "api_key",
        options.auth.value ?? ""
      );
    }
    url = parsed.toString();
  } catch {
    throw err("BAD_WS_URL", `Resolved WebSocket URL is invalid: ${url}`);
  }
  const headers = {};
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
  if (auth && auth.type !== "none" && !Object.keys(headers).some((k) => k.toLowerCase() === "authorization")) {
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
  const send = (Array.isArray(rawSend) ? rawSend : [rawSend]).map(
    (entry) => normalizePayload(
      typeof entry === "string" ? interpolate(entry, variables) : entry
    )
  ).filter((entry) => entry !== null);
  const keepAliveSource = ws.keepAlive ?? extension.keepAlive;
  return {
    url,
    subprotocols: ws.subprotocols ?? extension.subprotocols ?? [],
    headers,
    send,
    sendDelayMs: clampPositive(ws.sendDelayMs, 0),
    maxMessages: clampPositive(ws.maxMessages ?? options.maxEvents, 100),
    maxSessionMs: clampPositive(ws.maxSessionMs ?? options.maxStreamMs, 3e4),
    idleTimeoutMs: clampPositive(ws.idleTimeoutMs, 0),
    keepAlive: keepAliveSource ? {
      intervalMs: clampPositive(keepAliveSource.intervalMs, 15e3),
      payload: String(keepAliveSource.payload ?? "ping")
    } : void 0,
    closeCode: ws.closeCode ?? 1e3,
    closeReason: ws.closeReason ?? "Client finished sampling",
    rejectUnauthorized: ws.rejectUnauthorized !== false,
    maxPayloadBytes: clampPositive(ws.maxPayloadBytes, 1024 * 256),
    clientOptions: ws.clientOptions ?? {}
  };
}
function clampPositive(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
}

// src/protocols/ws/connection.ts
import WebSocket from "ws";
var NORMAL_CLOSE_CODES = /* @__PURE__ */ new Set([1e3, 1001, 1005]);
function runWebSocket(config, options) {
  const latch = createLatch();
  const startedAt = Date.now();
  let openedAt;
  let inboundCount = 0;
  let sequence = 0;
  let bytes = 0;
  let truncated = false;
  let closing = false;
  const events = [];
  const handshakeHeaders = {};
  let handshakeStatus = 0;
  let negotiatedProtocol;
  let failure;
  let sessionTimer = null;
  let idleTimer = null;
  let keepAliveTimer = null;
  const sendTimers = [];
  const clearAllTimers = () => {
    sessionTimer = safeClearTimeout(sessionTimer);
    idleTimer = safeClearTimeout(idleTimer);
    if (keepAliveTimer) {
      try {
        clearInterval(keepAliveTimer);
      } catch {
      }
      keepAliveTimer = null;
    }
    for (const timer of sendTimers.splice(0)) safeClearTimeout(timer);
  };
  let socket;
  try {
    socket = new WebSocket(config.url, config.subprotocols, {
      headers: config.headers,
      handshakeTimeout: Math.max(5e3, Math.min(config.maxSessionMs, 3e4)),
      rejectUnauthorized: config.rejectUnauthorized,
      maxPayload: config.maxPayloadBytes * 4,
      ...config.clientOptions
    });
  } catch (e) {
    return Promise.resolve(buildResult(toErrorInfo(e)));
  }
  function buildResult(error) {
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
          ...config.subprotocols.length ? { "Sec-WebSocket-Protocol": config.subprotocols.join(", ") } : {}
        },
        body: config.send.length ? config.send.map(
          (entry) => typeof entry === "string" ? entry : `<binary ${entry.byteLength} bytes>`
        ) : void 0
      },
      response: {
        status: handshakeStatus || (error ? 0 : 101),
        statusText: error ? "WebSocket error" : succeeded ? "Switching Protocols" : "Connection closed",
        headers: handshakeHeaders,
        contentType: "application/json",
        events,
        timings: {
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          firstByteMs: openedAt ? openedAt - startedAt : void 0
        },
        sizeBytes: bytes,
        ...truncated ? { truncated: true } : {}
      },
      ...negotiatedProtocol ? { cookies: [] } : {},
      ...error ? { error } : {}
    };
  }
  const finish = (error) => {
    if (latch.settled) return;
    clearAllTimers();
    latch.resolve(buildResult(error ?? failure));
  };
  const closeSocket = (reason) => {
    if (closing) return;
    closing = true;
    truncated = true;
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(
          config.closeCode,
          `${config.closeReason}: ${reason}`.slice(0, 120)
        );
      } else {
        socket.terminate();
      }
    } catch {
    }
    const guard = setTimeout(() => {
      try {
        socket.terminate();
      } catch {
      }
      finish();
    }, 3e3);
    if (typeof guard === "object" && typeof guard.unref === "function")
      guard.unref();
    sendTimers.push(guard);
  };
  const bumpIdleTimer = () => {
    if (!config.idleTimeoutMs) return;
    idleTimer = safeClearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => closeSocket("idle timeout"),
      config.idleTimeoutMs
    );
    if (typeof idleTimer === "object" && typeof idleTimer.unref === "function") {
      idleTimer.unref();
    }
  };
  const record = (event) => {
    events.push(event);
    try {
      options.onEvent?.(event);
    } catch {
    }
  };
  socket.on("upgrade", (response) => {
    handshakeStatus = response?.statusCode ?? 101;
    for (const [key, value] of Object.entries(response?.headers ?? {})) {
      handshakeHeaders[key] = Array.isArray(value) ? value.join(", ") : String(value);
    }
  });
  socket.on("unexpected-response", (_request, response) => {
    handshakeStatus = response?.statusCode ?? 0;
    for (const [key, value] of Object.entries(response?.headers ?? {})) {
      handshakeHeaders[key] = Array.isArray(value) ? value.join(", ") : String(value);
    }
    failure = {
      message: `Handshake rejected with HTTP ${handshakeStatus}`,
      code: "WS_HANDSHAKE_FAILED"
    };
    try {
      response?.destroy?.();
    } catch {
    }
    finish(failure);
  });
  socket.on("open", () => {
    openedAt = Date.now();
    negotiatedProtocol = socket.protocol || void 0;
    if (!handshakeStatus) handshakeStatus = 101;
    try {
      options.onOpen?.({
        url: config.url,
        protocol: negotiatedProtocol,
        headers: handshakeHeaders
      });
    } catch {
    }
    config.send.forEach((payload, index) => {
      const dispatch = () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(payload, (sendError) => {
          if (sendError) {
            failure = failure ?? toErrorInfo(sendError);
            return;
          }
          sequence += 1;
          record({
            id: String(sequence),
            event: typeof payload === "string" ? "text" : "binary",
            data: typeof payload === "string" ? payload : `<binary ${payload.byteLength} bytes>`,
            parsed: typeof payload === "string" ? tryParse(payload) : void 0,
            receivedAt: Date.now(),
            direction: "out"
          });
        });
      };
      const delay = config.sendDelayMs * index;
      if (delay <= 0) {
        dispatch();
      } else {
        const timer = setTimeout(dispatch, delay);
        if (typeof timer === "object" && typeof timer.unref === "function")
          timer.unref();
        sendTimers.push(timer);
      }
    });
    if (config.keepAlive) {
      keepAliveTimer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        try {
          socket.ping(config.keepAlive.payload);
        } catch {
        }
      }, config.keepAlive.intervalMs);
      if (typeof keepAliveTimer === "object" && typeof keepAliveTimer.unref === "function") {
        keepAliveTimer.unref();
      }
    }
    bumpIdleTimer();
  });
  socket.on("message", (raw, isBinary) => {
    if (closing) return;
    const buffer = toBuffer(raw);
    bytes += buffer.length;
    sequence += 1;
    inboundCount += 1;
    const oversized = buffer.length > config.maxPayloadBytes;
    const text = isBinary ? `<binary ${buffer.length} bytes>` : oversized ? `${buffer.subarray(0, config.maxPayloadBytes).toString("utf8")}...` : buffer.toString("utf8");
    record({
      id: String(sequence),
      event: isBinary ? "binary" : "text",
      data: text,
      parsed: !isBinary && !oversized ? tryParse(text) : void 0,
      receivedAt: Date.now(),
      direction: "in"
    });
    bumpIdleTimer();
    if (inboundCount >= config.maxMessages) closeSocket("maxMessages reached");
  });
  socket.on("ping", (payload) => {
    sequence += 1;
    record({
      id: String(sequence),
      event: "ping",
      data: payload?.length ? payload.toString("utf8") : "",
      receivedAt: Date.now(),
      direction: "in"
    });
    bumpIdleTimer();
  });
  socket.on("error", (socketError) => {
    failure = failure ?? toErrorInfo(socketError);
    if (socket.readyState === WebSocket.CLOSED) finish(failure);
  });
  socket.on("close", (code, reasonBuffer) => {
    const reason = reasonBuffer?.length ? reasonBuffer.toString("utf8") : "";
    if (!failure && !NORMAL_CLOSE_CODES.has(code) && !closing) {
      failure = {
        message: `Connection closed with code ${code}${reason ? `: ${reason}` : ""}`,
        code: String(code)
      };
    }
    finish(failure);
  });
  sessionTimer = setTimeout(
    () => closeSocket("maxSessionMs reached"),
    config.maxSessionMs
  );
  if (typeof sessionTimer === "object" && typeof sessionTimer.unref === "function") {
    sessionTimer.unref();
  }
  return latch.promise;
}
function toBuffer(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}
function tryParse(text) {
  const trimmed = text.trim();
  if (!trimmed || !/^[[{"\-\d]|^(true|false|null)$/.test(trimmed))
    return void 0;
  try {
    return JSON.parse(trimmed);
  } catch {
    return void 0;
  }
}

// src/protocols/ws/index.ts
var WebSocketAdapter = class {
  name = "websocket";
  supports(ctx) {
    const operation = ctx.located.operation ?? {};
    if (operation["x-protocol"] === "websocket" || operation["x-protocol"] === "ws")
      return 20;
    if (operation["x-websocket"] && typeof operation["x-websocket"] === "object")
      return 15;
    if (ctx.options.websocket?.url) return 15;
    if (ctx.located.pathItem?.["x-protocol"] === "websocket") return 12;
    return 0;
  }
  plan(ctx) {
    const config = resolveWsConfig(ctx.located, ctx.spec, ctx.options);
    return {
      config,
      environment: {
        id: `protokit-ws-env-${Date.now().toString(36)}`,
        name: `${ctx.spec?.info?.title ?? "API"} WebSocket Environment`,
        values: [
          { key: "wsUrl", value: config.url, type: "default", enabled: true },
          ...Object.entries(ctx.options.variables ?? {}).map(
            ([key, value]) => ({
              key,
              value: String(value ?? ""),
              type: /token|secret|password|apikey/i.test(key) ? "secret" : "default",
              enabled: true
            })
          )
        ],
        _postman_variable_scope: "environment"
      }
    };
  }
  execute(plan, options) {
    return runWebSocket(plan.config, options);
  }
};
export {
  WebSocketAdapter,
  resolveWsConfig,
  runWebSocket
};
//# sourceMappingURL=index.js.map