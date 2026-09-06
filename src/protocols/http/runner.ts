import runtime from "postman-runtime"; 
import sdk from "postman-collection";
import type {
  SendOptions,
  ExecResult,
  StreamEvent,
  ScriptReport,
  AssertionResult,
  ConsoleLog,
  ScriptOutcome,
  ReplayRecord,
} from "../../core/types";
import { err, toErrorInfo } from "../../core/errors";
import { createLatch, safeClearTimeout, jsonClone } from "../../core/utils";
import { SseParser } from "./sse-parser";
import { isSseContentType, isStreamingContentType } from "./detect";
import { buildRunOptions } from "./runner-options";

/** Flatten a Postman HeaderList into a plain object. */
function headersOf(headerList: any): Record<string, string> {
  const out: Record<string, string> = {};
  const all = typeof headerList?.all === "function" ? headerList.all() : [];
  for (const entry of all ?? []) {
    if (!entry || entry.disabled) continue;
    const key = String(entry.key ?? "");
    if (!key) continue;
    // Repeated headers are joined, matching how HTTP semantics treat them.
    out[key] = out[key]
      ? `${out[key]}, ${String(entry.value ?? "")}`
      : String(entry.value ?? "");
  }
  return out;
}

/** Snapshot a VariableScope as a plain key/value map. */
function scopeToObject(scope: any): Record<string, string> | undefined {
  if (!scope) return undefined;
  try {
    const source = scope.values ?? scope;
    const list = typeof source.toJSON === "function" ? source.toJSON() : source;
    if (!Array.isArray(list)) return undefined;
    const out: Record<string, string> = {};
    for (const entry of list) {
      if (!entry || entry.enabled === false || entry.key == null) continue;
      out[String(entry.key)] = entry.value == null ? "" : String(entry.value);
    }
    return out;
  } catch {
    return undefined;
  }
}

function tryParseJson(text: string | undefined, contentType?: string): unknown {
  if (!text) return undefined;
  if (contentType && !/json/i.test(contentType)) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (!/^[[{"\-\d]|^(true|false|null)$/.test(trimmed)) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function extractRequestBody(request: any): unknown {
  const body = request?.body;
  if (!body) return undefined;
  try {
    if (body.mode === "raw") return body.raw;
    if (typeof body.toString === "function") {
      const text = body.toString();
      return text || undefined;
    }
    return jsonClone(body);
  } catch {
    return undefined;
  }
}
export interface RunInput {
  collectionJson: any;
  baseUrl: string;
  /** Derived from the spec; the live content-type still has the final say. */
  streamingHint: boolean;
}

export function runWithPostman(
  input: RunInput,
  options: SendOptions,
): Promise<ExecResult> {
  const latch = createLatch<ExecResult>();

  // ---- Run state ----
  const startedAt = Date.now();
  let firstByteAt: number | undefined;
  let streaming = input.streamingHint;
  let stopRequested = false;
  let truncated = false;

  const parser = new SseParser();
  const events: StreamEvent[] = [];
  const bodyChunks: Buffer[] = [];
  let receivedBytes = 0;

  const report: ScriptReport = {
    prerequest: [],
    test: [],
    assertions: [],
    console: [],
    passed: true,
    skipped: false,
  };
  const replays: ReplayRecord[] = [];

  let captured: ExecResult | null = null;
  let runHandle: any = null;
  let streamTimer: ReturnType<typeof setTimeout> | null = null;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;

  const maxEvents = options.maxEvents ?? 100;
  const maxStreamMs = options.maxStreamMs ?? 30_000;
  const requestTimeout =
    options.runner?.timeout?.request ?? options.timeout ?? 30_000;

  /** Stop a long-lived stream once a sampling limit is reached. */
  const stopStream = (reason: string) => {
    if (stopRequested) return;
    stopRequested = true;
    truncated = true;
    report.console.push({
      level: "debug",
      messages: [`[protokit] stream sampling stopped: ${reason}`],
      at: Date.now(),
    });
    try {
      runHandle?.abort?.();
    } catch {
      /* The run may already be finished. */
    }
  };

  const toScriptOutcome = (
    entry: any,
    target: "prerequest" | "test",
  ): ScriptOutcome => ({
    target,
    scriptId: entry?.script?.id ?? entry?.event?.script?.id,
    error: entry?.error
      ? { name: entry.error.name, message: entry.error.message }
      : undefined,
    environment: scopeToObject(entry?.result?.environment),
    globals: scopeToObject(entry?.result?.globals),
    return: entry?.result?.return,
  });

  const finalize = () => {
    streamTimer = safeClearTimeout(streamTimer);
    hardTimer = safeClearTimeout(hardTimer);

    if (streaming) {
      // Emit any partial event still sitting in the parser buffer.
      for (const event of parser.flush()) {
        if (events.length < maxEvents) {
          events.push(event);
          safeInvoke(() => options.onEvent?.(event));
        }
      }
    }

    if (!captured) {
      const endedAt = Date.now();
      captured = {
        protocol: streaming ? "sse" : "http",
        request: { method: "", url: "", headers: {} },
        response: {
          status: stopRequested && events.length ? 200 : 0,
          statusText: stopRequested
            ? "Stream sampling stopped"
            : "No response received",
          headers: {},
          contentType: streaming ? "text/event-stream" : undefined,
          ...(streaming ? { events } : {}),
          timings: {
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            firstByteMs: firstByteAt ? firstByteAt - startedAt : undefined,
          },
          sizeBytes: receivedBytes,
          ...(truncated ? { truncated: true } : {}),
        },
        ...(stopRequested && events.length
          ? {}
          : { error: { message: "Runner finished without a response" } }),
      };
    } else if (streaming) {
      // Re-attach in case flush() produced events after the request callback ran.
      captured.response.events = events;
      if (truncated) captured.response.truncated = true;
    }

    captured.scripts = report;
    latch.resolve(captured);
  };

  // Absolute safety net: never let the promise hang if the runtime goes silent.
  hardTimer = setTimeout(
    () => {
      if (latch.settled) return;
      report.console.push({
        level: "error",
        messages: ["[protokit] hard timeout reached, forcing completion"],
        at: Date.now(),
      });
      try {
        runHandle?.abort?.();
      } catch {
        /* ignore */
      }
      truncated = true;
      finalize();
    },
    requestTimeout + maxStreamMs + 30_000,
  );
  // Do not keep the process alive solely for this watchdog.
  if (
    typeof hardTimer === "object" &&
    typeof (hardTimer as any).unref === "function"
  ) {
    (hardTimer as any).unref();
  }

  let collection: any;
  try {
    collection = new sdk.Collection(jsonClone(input.collectionJson));
  } catch (e) {
    hardTimer = safeClearTimeout(hardTimer);
    return Promise.reject(
      err(
        "BAD_COLLECTION",
        `Failed to construct collection: ${toErrorInfo(e).message}`,
        e,
      ),
    );
  }

  let runOptions: any;
  try {
    runOptions = buildRunOptions(options, {
      baseUrl: input.baseUrl,
      streaming: input.streamingHint,
    });
  } catch (e) {
    hardTimer = safeClearTimeout(hardTimer);
    return Promise.reject(
      err(
        "BAD_RUN_OPTIONS",
        `Failed to build runtime options: ${toErrorInfo(e).message}`,
        e,
      ),
    );
  }

  let runner: any;
  try {
    runner = new runtime.Runner();
  } catch (e) {
    hardTimer = safeClearTimeout(hardTimer);
    return Promise.reject(
      err(
        "RUNTIME_INIT",
        `Failed to create runner: ${toErrorInfo(e).message}`,
        e,
      ),
    );
  }

  runner.run(collection, runOptions, (initError: any, run: any) => {
    if (initError) {
      hardTimer = safeClearTimeout(hardTimer);
      latch.reject(
        err(
          "RUNTIME_INIT",
          initError.message ?? "Runner initialization failed",
          initError,
        ),
      );
      return;
    }
    runHandle = run;

    run.start({
      console(_cursor: any, level: any, ...logs: unknown[]) {
        const log: ConsoleLog = {
          level: (typeof level === "string"
            ? level
            : "log") as ConsoleLog["level"],
          messages: logs,
          at: Date.now(),
        };
        report.console.push(log);
        safeInvoke(() => options.onConsole?.(log));
      },

      assertion(_cursor: any, assertions: any[]) {
        for (const raw of assertions ?? []) {
          const assertion: AssertionResult = {
            name: raw?.name ?? "assertion",
            passed: !raw?.error && !raw?.skipped,
            skipped: !!raw?.skipped,
            index: typeof raw?.index === "number" ? raw.index : 0,
            error: raw?.error
              ? {
                  name: raw.error.name,
                  message: raw.error.message ?? String(raw.error),
                  stack: raw.error.stack,
                }
              : undefined,
          };
          if (!assertion.passed && !assertion.skipped) report.passed = false;
          report.assertions.push(assertion);
          safeInvoke(() => options.onAssertion?.(assertion));
        }
      },

      prerequest(_error: any, _cursor: any, results: any[]) {
        for (const entry of results ?? [])
          report.prerequest.push(toScriptOutcome(entry, "prerequest"));
      },

      test(_error: any, _cursor: any, results: any[]) {
        for (const entry of results ?? [])
          report.test.push(toScriptOutcome(entry, "test"));
      },

      item(
        _error: any,
        _cursor: any,
        _item: any,
        _visualizer: any,
        result: any,
      ) {
        if (result?.isSkipped) report.skipped = true;
      },

      // Fires as soon as headers arrive, before the body is complete.
      responseStart(_error: any, _cursor: any, response: any) {
        firstByteAt = Date.now();
        const contentType = safeGetHeader(response, "content-type");
        if (
          isSseContentType(contentType) ||
          isStreamingContentType(contentType)
        )
          streaming = true;

        safeInvoke(() =>
          options.onResponseStart?.({
            status: response?.code ?? 0,
            headers: headersOf(response?.headers),
            contentType,
          }),
        );

        if (streaming && !streamTimer) {
          streamTimer = setTimeout(
            () => stopStream("maxStreamMs reached"),
            maxStreamMs,
          );
          if (
            typeof streamTimer === "object" &&
            typeof (streamTimer as any).unref === "function"
          ) {
            (streamTimer as any).unref();
          }
        }
      },

      // Fires for every complete server-sent event, or for each body chunk.
      responseData(_cursor: any, data: any) {
        if (stopRequested || data == null) return;

        let chunk: Buffer;
        try {
          chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        } catch {
          return; // Undecodable chunk, skip rather than crash the run.
        }
        receivedBytes += chunk.length;

        if (!streaming) {
          bodyChunks.push(chunk);
          return;
        }

        for (const event of parser.push(chunk)) {
          if (events.length >= maxEvents) {
            stopStream("maxEvents reached");
            return;
          }
          events.push(event);
          safeInvoke(() => options.onEvent?.(event));
          if (events.length >= maxEvents) {
            stopStream("maxEvents reached");
            return;
          }
        }
      },

      // Fires once the request completes, including any replays.
      request(
        requestError: any,
        _cursor: any,
        response: any,
        request: any,
        _item: any,
        cookies: any,
      ) {
        const endedAt = Date.now();
        const requestInfo = {
          method: request?.method ?? "",
          url: safeUrlString(request),
          headers: headersOf(request?.headers),
          body: extractRequestBody(request),
        };

        if (requestError) {
          captured = {
            protocol: streaming ? "sse" : "http",
            request: requestInfo,
            response: {
              status: 0,
              statusText: "Request failed",
              headers: {},
              timings: { startedAt, endedAt, durationMs: endedAt - startedAt },
              sizeBytes: receivedBytes,
            },
            error: toErrorInfo(requestError),
            replays,
          };
          return;
        }

        const contentType = safeGetHeader(response, "content-type");
        if (
          isSseContentType(contentType) ||
          isStreamingContentType(contentType)
        )
          streaming = true;

        let text: string | undefined;
        let body: unknown;
        if (!streaming) {
          const buffer = bodyChunks.length
            ? Buffer.concat(bodyChunks)
            : response?.stream
              ? Buffer.from(response.stream)
              : Buffer.alloc(0);
          // Reject binary payloads instead of producing mojibake.
          text = looksBinary(buffer) ? undefined : buffer.toString("utf8");
          body = tryParseJson(text, contentType);
        }

        captured = {
          protocol: streaming ? "sse" : "http",
          request: requestInfo,
          response: {
            status: typeof response?.code === "number" ? response.code : 0,
            statusText: safeReason(response),
            headers: headersOf(response?.headers),
            contentType,
            ...(streaming ? { events } : { body, text }),
            timings: {
              startedAt,
              endedAt,
              durationMs:
                typeof response?.responseTime === "number"
                  ? response.responseTime
                  : endedAt - startedAt,
              firstByteMs: firstByteAt ? firstByteAt - startedAt : undefined,
            },
            sizeBytes: receivedBytes || response?.responseSize || 0,
            ...(truncated ? { truncated: true } : {}),
          },
          cookies: Array.isArray(cookies)
            ? cookies.map((cookie: any) => ({
                name: String(cookie?.name ?? ""),
                value: String(cookie?.value ?? ""),
                domain: cookie?.domain,
                path: cookie?.path,
              }))
            : [],
          replays,
        };
      },

      // Captures auxiliary traffic such as OAuth token refreshes and redirects.
      io(_error: any, _cursor: any, trace: any, response: any, request: any) {
        if (trace?.type !== "http") return;
        if (!trace.source || trace.source === "collection") return;
        replays.push({
          url: safeUrlString(request),
          method: request?.method ?? "",
          status: typeof response?.code === "number" ? response.code : 0,
          reason: String(trace.source),
        });
      },

      exception(_cursor: any, exception: any) {
        report.console.push({
          level: "error",
          messages: [`[exception] ${toErrorInfo(exception).message}`],
          at: Date.now(),
        });
      },

      done(doneError: any) {
        // Aborting on purpose is a normal termination for sampled streams.
        if (doneError && !captured && !stopRequested) {
          streamTimer = safeClearTimeout(streamTimer);
          hardTimer = safeClearTimeout(hardTimer);
          latch.reject(
            err("RUNTIME_RUN", doneError.message ?? "Run failed", doneError),
          );
          return;
        }
        finalize();
      },
    });
  });

  return latch.promise;
}

/** Invoke a user callback without letting it break the run. */
function safeInvoke(fn: () => void): void {
  try {
    fn();
  } catch {
    /* User callbacks must never abort execution. */
  }
}

function safeGetHeader(response: any, name: string): string | undefined {
  try {
    const value = response?.headers?.get?.(name);
    return value == null ? undefined : String(value);
  } catch {
    return undefined;
  }
}

function safeReason(response: any): string {
  try {
    return typeof response?.reason === "function"
      ? String(response.reason() ?? "")
      : String(response?.status ?? "");
  } catch {
    return "";
  }
}

function safeUrlString(request: any): string {
  try {
    return typeof request?.url?.toString === "function"
      ? request.url.toString()
      : "";
  } catch {
    return "";
  }
}

/** Heuristic binary detection based on NULL bytes in the leading window. */
function looksBinary(buffer: Buffer): boolean {
  const window = Math.min(buffer.length, 1024);
  for (let i = 0; i < window; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}
