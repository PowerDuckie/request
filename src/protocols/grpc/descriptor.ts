import { buildCatalog, type Catalog } from "./catalog.js";
import {
  DescriptorShapeError,
  readMethods,
  type MethodDescriptor,
} from "./descriptor-types.js";
import type { GrpcMethodKind, GrpcTarget } from "./types.js";

export interface ResolvedMethod {
  /**
   * The method name as declared in the descriptor, which may differ in case
   * from what the caller passed. Anything that records the call — exports,
   * logs, collection items — must use this rather than the input, or it will
   * record a name the server does not have.
   */
  name: string;
  kind: GrpcMethodKind;
  /** "/pkg.Service/Method" */
  path: string;
  requestStream: boolean;
  responseStream: boolean;
  serialize: (value: unknown) => Buffer;
  deserialize: (buffer: Buffer) => unknown;
  /** Fully-qualified request/response message names, when the descriptor had them. */
  inputType?: string;
  outputType?: string;
  /** How the descriptor was obtained. */
  source: "proto" | "reflection";
  /** Non-fatal notes worth surfacing. */
  notes: string[];
}

/**
 * A catalog already built for this endpoint, supplied to avoid re-reading the
 * proto tree and, under reflection, to avoid a second dial.
 *
 * Both halves are required together because they must come from ONE
 * buildCatalog call: the package definition is the runtime view and the catalog
 * is the metadata view of the same descriptors. Mixing views from two builds
 * would let the streaming cross-check below compare two different moments of
 * the server and refuse a call for a disagreement that never existed.
 */
export interface ResolveMethodOptions {
  catalog: Catalog;
  packageDefinition: Record<string, unknown>;
}

function kindOf(req: boolean, res: boolean): GrpcMethodKind {
  if (req && res) return "bidi_streaming";
  if (req) return "client_streaming";
  if (res) return "server_streaming";
  return "unary";
}

function stripDot(name: string): string {
  return name.startsWith(".") ? name.slice(1) : name;
}

/** The subset of proto-loader's MethodDefinition this module relies on. */
interface RuntimeMethod {
  path: string;
  requestStream: boolean;
  responseStream: boolean;
  requestSerialize: (v: unknown) => Buffer;
  responseDeserialize: (b: Buffer) => unknown;
}

/**
 * Verifies every field the interface claims, including the two booleans.
 *
 * Those two decide the streaming kind, and an entry that omits them is not a
 * method definition this module understands — treating a missing flag as false
 * is how a bidi method gets dialled as unary.
 */
function isRuntimeMethod(value: unknown): value is RuntimeMethod {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<RuntimeMethod>;
  return (
    typeof m.path === "string" &&
    typeof m.requestStream === "boolean" &&
    typeof m.responseStream === "boolean" &&
    typeof m.requestSerialize === "function" &&
    typeof m.responseDeserialize === "function"
  );
}

/** Trailing method name of "/pkg.Service/Method". */
function methodNameFromPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * Collapses proto-loader's method entries onto their wire names.
 *
 * proto-loader has historically keyed one method under both its declared name
 * and its lowerCamelCase form. Matching against raw keys therefore reports
 * `Say` as "ambiguous with say" for a service that declares a single method —
 * and reports it only on the call path, while discovery (which keys by path)
 * lists one method. The wire path is the authority in both places.
 */
function collapseRuntimeMethods(
  serviceDef: Record<string, unknown>,
): Map<string, RuntimeMethod> {
  const out = new Map<string, RuntimeMethod>();
  const chosenKey = new Map<string, string>();

  for (const [key, raw] of Object.entries(serviceDef)) {
    if (!isRuntimeMethod(raw)) continue;
    const wireName = methodNameFromPath(raw.path);
    // Keep the entry whose key matches the wire name, so diagnostics quote the
    // declared spelling rather than the camelCase alias.
    if (!out.has(wireName) || chosenKey.get(wireName) !== wireName) {
      out.set(wireName, raw);
      chosenKey.set(wireName, key);
    }
  }
  return out;
}

/**
 * Finds a name matching `wanted`, exactly if possible and otherwise
 * case-insensitively.
 *
 * The fallback exists because users type method names by hand, but it is
 * reported: silently invoking `Say` when the user wrote `say` is fine, silently
 * doing so when the service also declares `say` would not be.
 */
function matchName(
  names: string[],
  wanted: string,
): { name: string; exact: boolean } | undefined {
  if (names.includes(wanted)) return { name: wanted, exact: true };
  const lowered = wanted.toLowerCase();
  const candidates = names.filter((n) => n.toLowerCase() === lowered);
  if (candidates.length === 1) return { name: candidates[0], exact: false };
  return undefined;
}

/**
 * Reads the descriptor view of one service, degrading loudly.
 *
 * A descriptor that cannot be read costs the message type names and nothing
 * else — the codecs needed to place the call come from the runtime view. So
 * this returns undefined with a note instead of throwing; letting
 * DescriptorShapeError escape would abort a call that was fully equipped to
 * succeed.
 */
function readDescribedMethods(
  catalog: Catalog,
  service: string,
  notes: string[],
): MethodDescriptor[] | undefined {
  const descriptor = catalog.serviceDescriptors.get(service);
  if (descriptor === undefined) {
    notes.push(
      `no descriptor for ${service} in the ${catalog.source} catalog; ` +
        `the call can still be made but request templates and message type ` +
        `names are unavailable.`,
    );
    return undefined;
  }
  try {
    return readMethods(descriptor);
  } catch (e) {
    if (!(e instanceof DescriptorShapeError)) throw e;
    notes.push(
      `the descriptor for ${service} is unreadable, so message type names are ` +
        `unavailable and no request template can be generated; the call ` +
        `itself is unaffected: ${e.message}`,
    );
    return undefined;
  }
}

/**
 * Resolves one method to the codecs and streaming flags needed to invoke it.
 *
 * Two views are consulted and both must agree. The runtime view (proto-loader's
 * package definition) is the only source of codecs and paths; the descriptor
 * view is the only source of message type names. Where they overlap — the
 * streaming flags — a disagreement means one of them is describing a different
 * method, and the call is refused rather than guessed: choosing wrongly leaves
 * a stream that should be half-closed open, or closes one that should stay open,
 * and both present as a hang instead of an error.
 *
 * Called without `options` it builds a catalog itself, which means re-reading
 * the proto tree or re-dialling for reflection on every call. That cost is
 * accepted so that `grpcCall` stays usable on its own; anything issuing more
 * than one call should build the catalog once (or go through GrpcAdapter, which
 * caches it) and pass it here.
 */
export async function resolveMethod(
  target: GrpcTarget,
  options?: ResolveMethodOptions,
): Promise<ResolvedMethod> {
  const { catalog, packageDefinition } =
    options ?? (await buildCatalog(target));

  const notes = [...catalog.notes];

  /* ---- runtime view: codecs and path ---------------------------- */

  const serviceDef = packageDefinition[target.service];
  if (!serviceDef || typeof serviceDef !== "object") {
    const known = new Set([...catalog.invocableServices, ...catalog.services]);
    const hint = catalog.services.includes(target.service)
      ? ` It exists in the descriptor but no codecs were generated for it, ` +
        `so it cannot be called.`
      : ` Available: ${[...known].sort().join(", ") || "(none)"}`;
    throw new Error(
      `service "${target.service}" is not invocable (source: ${catalog.source}).${hint}`,
    );
  }

  const runtimeMethods = collapseRuntimeMethods(
    serviceDef as Record<string, unknown>,
  );
  const runtimeNames = [...runtimeMethods.keys()];

  const matched = matchName(runtimeNames, target.method);
  if (!matched) {
    const ambiguous =
      runtimeNames.filter(
        (n) => n.toLowerCase() === target.method.toLowerCase(),
      ).length > 1;
    throw new Error(
      ambiguous
        ? `method "${target.method}" is ambiguous on ${target.service}; ` +
            `several methods differ only in case. Use the exact name.`
        : `method "${target.method}" not found on ${target.service}. ` +
            `Available: ${[...runtimeNames].sort().join(", ") || "(none)"}`,
    );
  }
  if (!matched.exact) {
    notes.push(
      `method matched case-insensitively: requested "${target.method}", ` +
        `using "${matched.name}".`,
    );
  }

  // Guaranteed present: matched.name came from this map's keys.
  const runtime = runtimeMethods.get(matched.name)!;
  const requestStream = runtime.requestStream;
  const responseStream = runtime.responseStream;

  /* ---- descriptor view: type names, and a cross-check ----------- */

  const describedMethods = readDescribedMethods(catalog, target.service, notes);
  let described: MethodDescriptor | undefined;

  if (describedMethods) {
    described = describedMethods.find((m) => m.name === matched.name);
    if (!described) {
      notes.push(
        `method "${matched.name}" is invocable but absent from the ` +
          `${target.service} descriptor; message type names are unavailable.`,
      );
    }
  }

  if (
    described &&
    (described.clientStreaming !== requestStream ||
      described.serverStreaming !== responseStream)
  ) {
    throw new Error(
      `descriptor and runtime disagree on the streaming kind of ` +
        `${target.service}/${matched.name}: descriptor says ` +
        `${kindOf(described.clientStreaming, described.serverStreaming)}, ` +
        `runtime says ${kindOf(requestStream, responseStream)}. ` +
        `Refusing to dial, because either choice would misuse the stream. ` +
        `The descriptor source is likely stale or mixed — reload the proto ` +
        `tree, or clear cached reflection data.`,
    );
  }

  /* ---- path sanity --------------------------------------------- */

  const expectedPath = `/${target.service}/${matched.name}`;
  if (runtime.path !== expectedPath) {
    // Not fatal: the runtime path is authoritative and is what gets dialled.
    // But a mismatch means the service name we were given is not the one the
    // codecs belong to, which would otherwise only show up as a server-side
    // UNIMPLEMENTED.
    notes.push(
      `the method path reported by the loader (${runtime.path}) differs from ` +
        `the expected ${expectedPath}; the loader's path is used.`,
    );
  }

  return {
    name: matched.name,
    kind: kindOf(requestStream, responseStream),
    path: runtime.path,
    requestStream,
    responseStream,
    serialize: runtime.requestSerialize,
    deserialize: runtime.responseDeserialize,
    inputType: described ? stripDot(described.inputType) : undefined,
    outputType: described ? stripDot(described.outputType) : undefined,
    source: catalog.source,
    notes,
  };
}
