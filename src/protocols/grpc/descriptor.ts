import { buildCatalog } from "./catalog.js";
import { readMethods, type MethodDescriptor } from "./descriptor-types.js";
import type { GrpcMethodKind, GrpcTarget } from "./types.js";

export interface ResolvedMethod {
  kind: GrpcMethodKind;
  /** "/pkg.Service/Method" */
  path: string;
  requestStream: boolean;
  responseStream: boolean;
  serialize: (value: unknown) => Buffer;
  deserialize: (buffer: Buffer) => unknown;
  /** Fully-qualified request/response types, when the descriptor exposed them. */
  inputType?: string;
  outputType?: string;
  /** How the descriptor was obtained. */
  source: "proto" | "reflection";
  /** Non-fatal notes worth surfacing. */
  notes: string[];
}

/** Shape of one entry in a proto-loader ServiceDefinition. */
interface RuntimeMethod {
  path: string;
  requestStream: boolean;
  responseStream: boolean;
  requestSerialize: (v: unknown) => Buffer;
  responseDeserialize: (b: Buffer) => unknown;
}

function isRuntimeMethod(v: unknown): v is RuntimeMethod {
  const m = v as Partial<RuntimeMethod> | null;
  return (
    !!m &&
    typeof m === "object" &&
    typeof m.path === "string" &&
    typeof m.requestSerialize === "function" &&
    typeof m.responseDeserialize === "function"
  );
}

function kindOf(req: boolean, res: boolean): GrpcMethodKind {
  if (req && res) return "bidi_streaming";
  if (req) return "client_streaming";
  if (res) return "server_streaming";
  return "unary";
}

/** Trailing method name of "/pkg.Service/Method". */
function methodNameFromPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * Dependency sentinel.
 *
 * The runtime service definition (proto-loader) and the descriptor protos are
 * two independent views of the same service. They must agree. When they do
 * not, one of the two loading paths has silently degraded — historically the
 * descriptor path returning zero methods while the runtime path worked fine,
 * which produced the self-contradicting "method X not found. Available: X".
 *
 * Disagreement is reported as a note rather than an error: the runtime view is
 * sufficient to place the call, and refusing to dial because the *metadata*
 * view is stale would be a worse trade. `describeMethod` cannot fall back this
 * way and raises instead — see `describeFromCatalog`.
 */
export function crossCheckMethodViews(
  service: string,
  runtimeNames: string[],
  descriptorMethods: MethodDescriptor[] | undefined,
): string[] {
  const notes: string[] = [];
  if (descriptorMethods === undefined) return notes;

  const runtime = new Set(runtimeNames);
  const described = new Set(descriptorMethods.map((m) => m.name));

  if (described.size === 0 && runtime.size > 0) {
    notes.push(
      `descriptor view of ${service} lists no methods while the runtime view ` +
        `lists ${runtime.size} (${[...runtime].sort().join(", ")}). ` +
        `Request templates and type information are unavailable for this service.`,
    );
    return notes;
  }

  const missingFromDescriptor = [...runtime].filter((n) => !described.has(n));
  const missingFromRuntime = [...described].filter((n) => !runtime.has(n));

  if (missingFromDescriptor.length) {
    notes.push(
      `methods present at runtime but absent from the descriptor of ` +
        `${service}: ${missingFromDescriptor.sort().join(", ")}.`,
    );
  }
  if (missingFromRuntime.length) {
    notes.push(
      `methods present in the descriptor but not invocable on ${service}: ` +
        `${missingFromRuntime.sort().join(", ")}.`,
    );
  }

  return notes;
}

/**
 * Resolves one method to the codecs and streaming flags needed to invoke it.
 *
 * The streaming kind has exactly one source — the descriptor — and is never
 * accepted from the caller, so a mismatch between declaration and runtime
 * behaviour is not representable. Where the two available descriptor views
 * disagree, the runtime view wins for dialling and the disagreement is
 * reported.
 */
export async function resolveMethod(
  target: GrpcTarget,
): Promise<ResolvedMethod> {
  const { catalog, packageDefinition } = await buildCatalog(target);
  const notes = [...catalog.notes];

  const serviceDef = packageDefinition[target.service];
  if (!serviceDef || typeof serviceDef !== "object") {
    throw new Error(
      `service "${target.service}" not found (source: ${catalog.source}). ` +
        `Available: ${catalog.services.join(", ") || "(none)"}`,
    );
  }

  const def = serviceDef as Record<string, unknown>;
  const runtimeEntries = new Map<string, RuntimeMethod>();
  for (const [key, value] of Object.entries(def)) {
    if (isRuntimeMethod(value)) runtimeEntries.set(key, value);
  }

  if (runtimeEntries.size === 0) {
    throw new Error(
      `service "${target.service}" was found (source: ${catalog.source}) but ` +
        `exposes no invocable methods. The descriptor source is incomplete; ` +
        `keys present: [${Object.keys(def).sort().join(", ") || "(none)"}].`,
    );
  }

  // Descriptor view, when the catalog carried one. Never fatal here.
   let describedMethods: MethodDescriptor[] | undefined;
  const serviceDescriptor = catalog.serviceDescriptors.get(target.service);
  if (serviceDescriptor === undefined) {
    notes.push(
      `no descriptor for ${target.service} in the ${catalog.source} catalog; ` +
        `calling is still possible but type information is unavailable.`,
    );
  } else {
    try {
      describedMethods = readMethods(serviceDescriptor);
    } catch (e) {
      notes.push(
        `descriptor for ${target.service} is unreadable: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  notes.push(
    ...crossCheckMethodViews(
      target.service,
      [...runtimeEntries.keys()],
      describedMethods,
    ),
  );

  const requested = target.method;
  let methodKey = runtimeEntries.has(requested) ? requested : undefined;

  if (!methodKey) {
    // proto-loader has historically keyed definitions by both the declared
    // name and its lowerCamelCase form; match on the wire path as the
    // authority before falling back to a case-insensitive scan.
    for (const [key, entry] of runtimeEntries) {
      if (methodNameFromPath(entry.path) === requested) {
        methodKey = key;
        break;
      }
    }
    if (methodKey && methodKey !== requested) {
      notes.push(
        `method "${requested}" matched via its wire path; ` +
          `definition key is "${methodKey}".`,
      );
    }
  }

  if (!methodKey) {
    const ciMatches = [...runtimeEntries.keys()].filter(
      (k) => k.toLowerCase() === requested.toLowerCase(),
    );
    if (ciMatches.length === 1) {
      methodKey = ciMatches[0];
      notes.push(
        `method matched case-insensitively: requested "${requested}", ` +
          `using "${methodKey}".`,
      );
    } else if (ciMatches.length > 1) {
      throw new Error(
        `method "${requested}" is ambiguous on ${target.service}: ` +
          `${ciMatches.sort().join(", ")}. Use the exact declared name.`,
      );
    }
  }

  if (!methodKey) {
    throw new Error(
      `method "${requested}" not found on ${target.service} ` +
        `(source: ${catalog.source}). ` +
        `Available: ${[...runtimeEntries.keys()].sort().join(", ")}`,
    );
  }

  const m = runtimeEntries.get(methodKey)!;
  const described = describedMethods?.find(
    (d) => d.name === methodKey || d.name === requested,
  );

  if (described) {
    if (
      described.clientStreaming !== m.requestStream ||
      described.serverStreaming !== m.responseStream
    ) {
      // Not recoverable by choosing a side: picking the wrong one means
      // half-closing a stream that must stay open, or never half-closing one
      // that must. Refuse rather than guess.
      throw new Error(
        `streaming flags disagree for ${target.service}/${methodKey}: ` +
          `descriptor says ${kindOf(described.clientStreaming, described.serverStreaming)}, ` +
          `runtime says ${kindOf(m.requestStream, m.responseStream)}. ` +
          `The descriptor source and the loaded definition are out of sync.`,
      );
    }
  }

  return {
    kind: kindOf(m.requestStream === true, m.responseStream === true),
    path: m.path,
    requestStream: m.requestStream === true,
    responseStream: m.responseStream === true,
    serialize: m.requestSerialize,
    deserialize: m.responseDeserialize,
    inputType: described?.inputType,
    outputType: described?.outputType,
    source: catalog.source,
    notes,
  };
}
