import sdk from "postman-collection";
import type {
  RuntimeRunOptions,
  SendOptions,
  RequesterOptions,
} from "../../core/types";
import { deepMerge } from "../../core/utils";

/** Build a VariableScope from a plain key/value map. */
function toVariableScope(
  values?: Record<string, string>,
  seed: Array<{ key: string; value: string }> = [],
): any {
  const entries = [
    ...seed,
    ...Object.entries(values ?? {}).map(([key, value]) => ({
      key,
      value: value == null ? "" : String(value),
    })),
  ];
  // Later entries win, mirroring how Postman resolves duplicate keys.
  const deduped = new Map<string, { key: string; value: string }>();
  for (const entry of entries) deduped.set(entry.key, entry);
  return new sdk.VariableScope({ values: Array.from(deduped.values()) });
}

export interface BuildRunOptionsInput {
  baseUrl: string;
  /** True when the operation is expected to stream, which relaxes the global timeout. */
  streaming: boolean;
}

/**
 * Compose the final postman-runtime options object.
 *
 * Precedence, lowest to highest:
 *   1. Library defaults
 *   2. Convenience fields on SendOptions (timeout, variables, globals, ...)
 *   3. `options.runner` — every documented runtime option, passed straight through
 *
 * Scopes are only synthesized when the caller did not supply their own.
 */
export function buildRunOptions(
  options: SendOptions,
  input: BuildRunOptionsInput,
): RuntimeRunOptions {
  const requestTimeout =
    options.runner?.timeout?.request ?? options.timeout ?? 30_000;
  const streamBudget = input.streaming ? (options.maxStreamMs ?? 30_000) : 0;

  const defaultRequester: RequesterOptions = {
    strictSSL: true,
    followRedirects: true,
    followOriginalHttpMethod: false,
    maxRedirects: 10,
    useWhatWGUrlParser: true,
    removeRefererHeaderOnRedirect: false,
    insecureHTTPParser: false,
    // Timings and verbose history power the firstByteMs metric and replay list.
    timings: true,
    verbose: true,
    implicitCacheControl: true,
    implicitTraceHeader: true,
    disableCookies: false,
    protocolVersion: "http1",
    maxInvokableNestedRequests: 5,
  };

  const defaults: RuntimeRunOptions = {
    iterationCount: 1,
    // Halt gracefully so item and iteration callbacks still fire on failure.
    stopOnError: false,
    abortOnError: false,
    stopOnFailure: false,
    abortOnFailure: false,
    timeout: {
      request: requestTimeout,
      script: 15_000,
      // The global budget must outlast the request plus the streaming window.
      global: requestTimeout + streamBudget + 15_000,
    },
    delay: { item: 0, iteration: 0 },
    script: { serializeLogs: false },
    ignoreProxyEnvironmentVariables: false,
    requester: defaultRequester,
  };

  // Convenience layer derived from the flat SendOptions fields.
  const merged = deepMerge(defaults, {});

  // Full passthrough of user-provided runtime options.
  const final = deepMerge(merged, options.runner ?? {});
  
  // Scopes: only build them when the caller has not provided a VariableScope.
  if (!final.environment) {
    final.environment = toVariableScope(options.variables, [
      { key: "baseUrl", value: input.baseUrl },
    ]);
  }
  if (!final.globals && options.globals) {
    final.globals = toVariableScope(options.globals);
  }
  if (!final.localVariables && options.localVariables) {
    final.localVariables = toVariableScope(options.localVariables);
  }

  // Iteration count must stay consistent with the supplied data set.
  if (
    Array.isArray(final.data) &&
    final.data.length &&
    options.runner?.iterationCount === undefined
  ) {
    final.iterationCount = final.data.length;
  }

  return final;
}
