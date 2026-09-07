import { loadGrpc } from "./loader.js";
import { buildCredentialsChecked } from "./credentials.js";
import { resolveMethod } from "./descriptor.js";
import type {
  GrpcEvent,
  GrpcResult,
  GrpcSendOptions,
  GrpcStatus,
  GrpcStatusOrigin,
  GrpcTarget,
  GrpcTruncatedReason,
} from "./types.js";

const CODE_NAMES: Record<number, string> = {
  0: "OK",
  1: "CANCELLED",
  2: "UNKNOWN",
  3: "INVALID_ARGUMENT",
  4: "DEADLINE_EXCEEDED",
  5: "NOT_FOUND",
  6: "ALREADY_EXISTS",
  7: "PERMISSION_DENIED",
  8: "RESOURCE_EXHAUSTED",
  9: "FAILED_PRECONDITION",
  10: "ABORTED",
  11: "OUT_OF_RANGE",
  12: "UNIMPLEMENTED",
  13: "INTERNAL",
  14: "UNAVAILABLE",
  15: "DATA_LOSS",
  16: "UNAUTHENTICATED",
};

const CODE_CANCELLED = 1;
const CODE_UNKNOWN = 2;
const CODE_INVALID_ARGUMENT = 3;

function toStatus(code: number, details?: string): GrpcStatus {
  return { code, codeName: CODE_NAMES[code] ?? `CODE_${code}`, details };
}

/**
 * grpc-js `Metadata.toJSON()` returns every key as an array, which is the only
 * honest shape: HTTP/2 headers can repeat. Binary (`-bin`) values arrive as
 * Buffers and are base64-encoded so the result stays JSON-serialisable.
 */
function metadataToObject(md: unknown): Record<string, string[]> {
  const anyMd = md as { toJSON?: () => Record<string, unknown> } | undefined;
  if (typeof anyMd?.toJSON !== "function") return {};

  const out: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(anyMd.toJSON())) {
    const items = Array.isArray(raw) ? raw : [raw];
    out[key] = items.map((v) =>
      Buffer.isBuffer(v) ? v.toString("base64") : String(v),
    );
  }
  return out;
}

interface AnyCall {
  cancel: () => void;
  write?: (v: unknown) => void;
  end?: () => void;
  on: (ev: string, fn: (...args: unknown[]) => void) => void;
}

/** Termination reasons the client caused, as opposed to the server or network. */
const CLIENT_INITIATED: ReadonlySet<GrpcTruncatedReason> = new Set([
  "max_messages",
  "idle_timeout",
  "max_session",
  "aborted",
]);

/**
 * Invokes one gRPC method. All four streaming kinds converge on a single event
 * log and a single set of termination conditions.
 *
 * Transport-level failures are reported in the result rather than thrown; only
 * descriptor resolution (which happens before any bytes move) throws. See the
 * note on `resolveMethod` — the two are deliberately different because one is a
 * caller mistake and the other is an observation about the world.
 */
export async function grpcCall(
  target: GrpcTarget,
  options: GrpcSendOptions = {},
): Promise<GrpcResult> {
  const startedAt = Date.now();
  const loaded = await loadGrpc();
  const { grpc } = loaded;
  const method = await resolveMethod(target);

  const warnings = [...method.notes];
  const events: GrpcEvent[] = [];
  const inbound: unknown[] = [];
  let seq = 0;
  let truncated = false;
  let truncatedReason: GrpcTruncatedReason | undefined;
  let error: string | undefined;
  let status: GrpcStatus | undefined;
  let statusOrigin: GrpcStatusOrigin | undefined;
  let initialMetadata: Record<string, string[]> | undefined;
  let trailers: Record<string, string[]> | undefined;
  const outbound = options.messages ?? [];

  /* ---------------------------------------------------------------- *
   * Option consistency, checked before anything is dialled
   * ---------------------------------------------------------------- */

  if (!method.requestStream && outbound.length > 1) {
    warnings.push(
      `${method.kind} accepts a single request message; ` +
        `${outbound.length - 1} extra message(s) were ignored.`,
    );
  }
  if (options.keepWriteOpen && method.kind !== "bidi_streaming") {
    warnings.push(
      `keepWriteOpen only applies to bidi_streaming; ignored for ${method.kind}.`,
    );
  }
  if (options.sendIntervalMs !== undefined && !method.requestStream) {
    warnings.push(
      `sendIntervalMs paces the outbound stream and has no effect on ` +
        `${method.kind}, which sends exactly one message.`,
    );
  }
  if (options.maxMessages !== undefined && options.maxMessages < 0) {
    throw new RangeError(
      `maxMessages must be >= 0; received ${options.maxMessages}.`,
    );
  }
  if (
    options.keepWriteOpen &&
    method.kind === "bidi_streaming" &&
    options.maxSessionMs === undefined &&
    options.idleTimeoutMs === undefined &&
    options.maxMessages === undefined &&
    !options.signal &&
    target.deadlineMs === undefined
  ) {
    warnings.push(
      "keepWriteOpen is set with no limit and no deadline; " +
        "the call can only end when the server closes the stream.",
    );
  }

  const creds = buildCredentialsChecked(target, loaded);
  warnings.push(...creds.warnings);

  const client = new grpc.Client(
    target.address,
    creds.credentials,
    target.channelOptions as never,
  );

  const md = new grpc.Metadata();
  for (const [k, v] of Object.entries(target.metadata ?? {})) {
    for (const item of Array.isArray(v) ? v : [v]) md.add(k, item);
  }

  const callOptions: Record<string, unknown> = {};
  if (target.deadlineMs !== undefined) {
    callOptions.deadline = new Date(Date.now() + target.deadlineMs);
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    /** Set once the authoritative outcome is known; late events cannot overwrite it. */
    let outcomeLocked = false;
    let idleTimer: NodeJS.Timeout | undefined;
    let sessionTimer: NodeJS.Timeout | undefined;
    let sendTimer: NodeJS.Timeout | undefined;
    let call: AnyCall | undefined;
    let abortListener: (() => void) | undefined;

    /**
     * Events are dropped after the call has settled.
     *
     * Cancelling a call makes grpc-js emit a further error/status pair, and
     * appending those would mean the event log continues past the moment the
     * result claims the session ended.
     */
    const emit = (event: Omit<GrpcEvent, "seq" | "at">): void => {
      if (settled) return;
      const full: GrpcEvent = { ...event, seq: seq++, at: Date.now() };
      events.push(full);
      if (!options.onEvent) return;
      try {
        options.onEvent(full);
      } catch {
        // A throwing callback must never take down the call; mirrors http/ws.
      }
    };

    const setOutcome = (
      next: GrpcStatus,
      origin: GrpcStatusOrigin,
      err?: string,
    ): void => {
      if (outcomeLocked) return;
      outcomeLocked = true;
      status = next;
      statusOrigin = origin;
      // A client-initiated stop is not a failure to report as `error`; the
      // truncation fields already describe it.
      if (err !== undefined && !truncated) error = err;
    };

    const finish = (reason?: GrpcTruncatedReason): void => {
      if (settled) return;

      if (reason) {
        truncated = true;
        truncatedReason = reason;

        // Every client-initiated stop gets a status, synthesised when the
        // server will never send one. Without this, max_messages was the only
        // termination path that produced an undefined status while the other
        // three surfaced a real CANCELLED — one meaning, two shapes.
        if (CLIENT_INITIATED.has(reason) && !outcomeLocked) {
          setOutcome(
            toStatus(
              CODE_CANCELLED,
              `call stopped by the client (${reason}); ` +
                `the server never reported a status`,
            ),
            "synthesized",
          );
        }
      }

      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(sessionTimer);
      clearTimeout(sendTimer);
      if (abortListener && options.signal) {
        options.signal.removeEventListener("abort", abortListener);
      }
      try {
        call?.cancel();
      } catch {
        /* already closed */
      }
      try {
        client.close();
      } catch {
        /* already closed */
      }
      resolve();
    };

    const bumpIdle = (): void => {
      if (options.idleTimeoutMs === undefined) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => finish("idle_timeout"),
        options.idleTimeoutMs,
      );
    };

    const onInbound = (payload: unknown): void => {
      if (settled) return;
      inbound.push(payload);
      emit({ direction: "inbound", payload });
      bumpIdle();
      if (
        options.maxMessages !== undefined &&
        inbound.length >= options.maxMessages
      ) {
        finish("max_messages");
      }
    };

    const onCallError = (err: unknown): void => {
      const e = err as { code?: number; message?: string; details?: string };
      setOutcome(
        toStatus(e.code ?? CODE_UNKNOWN, e.details ?? e.message),
        "server",
        e.message ?? String(err),
      );
      finish();
    };

    // maxMessages: 0 means "do not accept any response", which has to be
    // handled before the first message rather than after it.
    if (options.maxMessages === 0) {
      warnings.push(
        "maxMessages is 0, so the call is stopped before any response is read.",
      );
      finish("max_messages");
      return;
    }

    if (options.maxSessionMs !== undefined) {
      sessionTimer = setTimeout(
        () => finish("max_session"),
        options.maxSessionMs,
      );
    }

    if (options.signal) {
      if (options.signal.aborted) {
        finish("aborted");
        return;
      }
      abortListener = () => finish("aborted");
      options.signal.addEventListener("abort", abortListener, { once: true });
    }

    const serialize = (v: unknown): Buffer => method.serialize(v);
    const deserialize = (b: Buffer): unknown => method.deserialize(b);

    /**
     * Serialises eagerly so a malformed request message is reported as a
     * client-side INVALID_ARGUMENT naming the offending index, instead of
     * surfacing as an opaque UNKNOWN from inside the transport.
     */
    const precheck = (payload: unknown, index: number): boolean => {
      try {
        method.serialize(payload);
        return true;
      } catch (e) {
        setOutcome(
          toStatus(
            CODE_INVALID_ARGUMENT,
            `request message #${index} does not match ${method.inputType ?? "the request type"}`,
          ),
          "client",
          e instanceof Error ? e.message : String(e),
        );
        finish();
        return false;
      }
    };

    /** Attaches the listeners every call kind shares. */
    const attachCommon = (c: AnyCall): void => {
      c.on("metadata", (initial) => {
        initialMetadata = metadataToObject(initial);
        emit({ direction: "meta", metadata: initialMetadata });
      });
      c.on("status", (s) => {
        const st = s as { code: number; details?: string; metadata?: unknown };
        trailers = metadataToObject(st.metadata);
        // For unary and client-streaming the callback is authoritative, so the
        // status event only fills in what the callback has not already set.
        setOutcome(toStatus(st.code, st.details), "server");
        emit({ direction: "meta", status: toStatus(st.code, st.details) });
        if (method.responseStream) finish();
      });
    };

    /** Writes the outbound queue, optionally paced, then half-closes. */
    const startWriting = (c: AnyCall): void => {
      let index = 0;
      const writeNext = (): void => {
        if (settled) return;
        if (index >= outbound.length) {
          const keepOpen =
            options.keepWriteOpen === true && method.kind === "bidi_streaming";
          if (!keepOpen) {
            try {
              c.end?.();
            } catch {
              /* already closed */
            }
          }
          return;
        }
        const at = index;
        const payload = outbound[index++];
        if (!precheck(payload, at)) return;
        try {
          c.write?.(payload);
          emit({ direction: "outbound", payload });
        } catch (e) {
          setOutcome(
            toStatus(CODE_UNKNOWN, `write of message #${at} failed`),
            "client",
            e instanceof Error ? e.message : String(e),
          );
          finish();
          return;
        }
        if (options.sendIntervalMs) {
          sendTimer = setTimeout(writeNext, options.sendIntervalMs);
        } else {
          writeNext();
        }
      };
      writeNext();
    };

    try {
      if (method.kind === "unary" || method.kind === "server_streaming") {
        const payload = outbound[0] ?? {};
        if (!precheck(payload, 0)) return;
        // Emitted before dialling so the outbound event cannot be ordered
        // after a synchronously delivered response or failure.
        emit({ direction: "outbound", payload });

        if (method.kind === "unary") {
          call = client.makeUnaryRequest(
            method.path,
            serialize,
            deserialize,
            payload,
            md,
            callOptions as never,
            (err, value) => {
              if (err) onCallError(err);
              else {
                setOutcome(toStatus(0), "server");
                onInbound(value);
                finish();
              }
            },
          ) as unknown as AnyCall;
          attachCommon(call);
          // Unary calls surface failures through the callback, but a channel
          // level error can also reach the emitter; both funnel to one place.
          call.on("error", onCallError);
        } else {
          call = client.makeServerStreamRequest(
            method.path,
            serialize,
            deserialize,
            payload,
            md,
            callOptions as never,
          ) as unknown as AnyCall;
          attachCommon(call);
          call.on("data", (p) => onInbound(p));
          call.on("error", onCallError);
          call.on("end", () => {
            setOutcome(toStatus(0), "server");
            finish();
          });
        }
      } else if (method.kind === "client_streaming") {
        call = client.makeClientStreamRequest(
          method.path,
          serialize,
          deserialize,
          md,
          callOptions as never,
          (err, value) => {
            if (err) onCallError(err);
            else {
              setOutcome(toStatus(0), "server");
              onInbound(value);
              finish();
            }
          },
        ) as unknown as AnyCall;
        attachCommon(call);
        call.on("error", onCallError);
        startWriting(call);
      } else {
        call = client.makeBidiStreamRequest(
          method.path,
          serialize,
          deserialize,
          md,
          callOptions as never,
        ) as unknown as AnyCall;
        attachCommon(call);
        call.on("data", (p) => onInbound(p));
        call.on("error", onCallError);
        call.on("end", () => {
          setOutcome(toStatus(0), "server");
          finish();
        });
        startWriting(call);
      }
    } catch (e) {
      setOutcome(
        toStatus(CODE_UNKNOWN, "call setup failed"),
        "client",
        e instanceof Error ? e.message : String(e),
      );
      finish();
      return;
    }

    bumpIdle();
  });

  return {
    protocol: "grpc",
    kind: method.kind,
    target,
    events,
    messages: inbound,
    initialMetadata, //Type 'Record<string, string | string[]> | undefined' is not assignable to type 'Record<string, string[]> | undefined'.

    status,
    statusOrigin,
    trailers, //Type 'Record<string, string | string[]> | undefined' is not assignable to type 'Record<string, string[]> | undefined'.

    truncated,
    truncatedReason,
    error,
    warnings,
    durationMs: Date.now() - startedAt,
  };
}
