import { loadGrpc, requireCapability } from "./loader.js";
import { buildCredentialsChecked } from "./credentials.js";
import { scanProtoFiles, deriveIncludeDirsDetailed } from "./proto-dir.js";
import { fetchFullDescriptorSet } from "./reflection.js";
import {
  decodeFileDescriptorProto,
  decodeFileDescriptorSet,
  type DecodedFile,
} from "./file-descriptor.js";
import { isMapEntry, pick } from "./descriptor-types.js";
import type { GrpcEndpoint } from "./types.js";

/**
 * Loader options are part of the contract, not an implementation detail:
 * `keepCase` decides whether request JSON keys are snake_case or camelCase, and
 * `enums`/`longs` decide the JSON form of values. template.ts derives the shape
 * it generates from these, so the two can never drift.
 */
export const LOADER_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
} as const;

export type SymbolKind = "service" | "message" | "enum";

export interface SymbolEntry {
  kind: SymbolKind;
  /**
   * The decoded descriptor. Always present — a symbol we cannot describe is not
   * registered at all, because an entry with an absent descriptor is exactly the
   * failure mode that made method lists silently empty.
   */
  type: unknown;
  /** File the symbol was declared in, for diagnostics. */
  file: string;
}

export interface Catalog {
  source: "proto" | "reflection";
  /** Fully-qualified name (no leading dot) -> entry. Map entries excluded. */
  symbols: Map<string, SymbolEntry>;
  /** Service names known from descriptors, sorted. */
  services: string[];
  /** Service names the runtime can actually dial, sorted. */
  invocableServices: string[];
  /** Fully-qualified service name -> ServiceDescriptorProto. */
  serviceDescriptors: Map<string, unknown>;
  /** Non-fatal facts worth surfacing to the user. */
  notes: string[];
  /** Proto files loaded, or descriptor file names when source is reflection. */
  files?: string[];
}

function qualify(pkg: string, name: string): string {
  return pkg ? `${pkg}.${name}` : name;
}

/* ------------------------------------------------------------------ *
 * Symbol table, built from decoded FileDescriptorProtos.
 *
 * This is the metadata view. It is the only source of method signatures,
 * field types and oneof structure; proto-loader's package definition cannot
 * provide any of them.
 * ------------------------------------------------------------------ */

function registerMessage(
  symbols: Map<string, SymbolEntry>,
  notes: string[],
  file: string,
  scope: string,
  message: unknown,
): void {
  const name = String(pick(message, "name", "name") ?? "");
  if (!name) {
    notes.push(`${file}: a message with no name was skipped.`);
    return;
  }
  const fq = qualify(scope, name);

  // Map fields are modelled as a repeated synthetic message with
  // map_entry=true. It is an implementation detail of the encoding, never a
  // type the user can name, so it must not appear in the symbol table.
  if (!isMapEntry(message)) {
    const existing = symbols.get(fq);
    if (existing) {
      notes.push(
        `duplicate definition of "${fq}" (${existing.file} and ${file}); ` +
          `the first one was kept.`,
      );
    } else {
      symbols.set(fq, { kind: "message", type: message, file });
    }
  }

  for (const nested of (pick<unknown[]>(message, "nestedType", "nested_type") ??
    []) as unknown[]) {
    registerMessage(symbols, notes, file, fq, nested);
  }
  for (const nestedEnum of (pick<unknown[]>(message, "enumType", "enum_type") ??
    []) as unknown[]) {
    registerEnum(symbols, notes, file, fq, nestedEnum);
  }
}

function registerEnum(
  symbols: Map<string, SymbolEntry>,
  notes: string[],
  file: string,
  scope: string,
  enumType: unknown,
): void {
  const name = String(pick(enumType, "name", "name") ?? "");
  if (!name) {
    notes.push(`${file}: an enum with no name was skipped.`);
    return;
  }
  const fq = qualify(scope, name);
  if (symbols.has(fq)) return;
  symbols.set(fq, { kind: "enum", type: enumType, file });
}

function indexFile(
  symbols: Map<string, SymbolEntry>,
  serviceDescriptors: Map<string, unknown>,
  notes: string[],
  fileDescriptor: DecodedFile,
): void {
  const file = String(pick(fileDescriptor, "name", "name") ?? "(unnamed)");
  const pkg = String(pick(fileDescriptor, "package", "package") ?? "");

  for (const message of (pick<unknown[]>(
    fileDescriptor,
    "messageType",
    "message_type",
  ) ?? []) as unknown[]) {
    registerMessage(symbols, notes, file, pkg, message);
  }
  for (const enumType of (pick<unknown[]>(
    fileDescriptor,
    "enumType",
    "enum_type",
  ) ?? []) as unknown[]) {
    registerEnum(symbols, notes, file, pkg, enumType);
  }
  for (const service of (pick<unknown[]>(
    fileDescriptor,
    "service",
    "service",
  ) ?? []) as unknown[]) {
    const name = String(pick(service, "name", "name") ?? "");
    if (!name) {
      notes.push(`${file}: a service with no name was skipped.`);
      continue;
    }
    const fq = qualify(pkg, name);
    if (serviceDescriptors.has(fq)) {
      notes.push(
        `duplicate definition of service "${fq}"; the first one was kept.`,
      );
      continue;
    }
    symbols.set(fq, { kind: "service", type: service, file });
    serviceDescriptors.set(fq, service);
  }
}

/* ------------------------------------------------------------------ *
 * Runtime view, from proto-loader's package definition.
 *
 * This is the only source of codecs and method paths — the things needed to
 * actually place a call. It carries no method metadata whatsoever, which is
 * why it can never be the source of a method list.
 * ------------------------------------------------------------------ */

function collectInvocableServices(
  packageDefinition: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(packageDefinition)) {
    if (!value || typeof value !== "object") continue;
    const methods = Object.values(value as Record<string, unknown>);
    if (methods.length === 0) continue;
    // A ServiceDefinition is a flat record of method definitions, each with a
    // string `path`. Message and enum entries never match this shape.
    const allMethods = methods.every(
      (m) =>
        m !== null &&
        typeof m === "object" &&
        typeof (m as { path?: unknown }).path === "string",
    );
    if (allMethods) out.push(name);
  }
  return out.sort();
}

/**
 * Extracts the raw FileDescriptorProto bytes proto-loader attaches to each
 * message and enum entry it produces.
 *
 * This is a documented part of its output, and it is the only way to get
 * descriptor metadata out of a `load()` call. Every entry carries the same
 * transitive closure, so they are de-duplicated by content.
 */
function harvestFileDescriptors(packageDefinition: Record<string, unknown>): {
  buffers: Buffer[];
  found: boolean;
} {
  const seen = new Set<string>();
  const buffers: Buffer[] = [];
  let found = false;

  for (const value of Object.values(packageDefinition)) {
    const protos = (value as { fileDescriptorProtos?: unknown } | undefined)
      ?.fileDescriptorProtos;
    if (!Array.isArray(protos)) continue;
    found = true;
    for (const raw of protos) {
      if (!Buffer.isBuffer(raw) && !(raw instanceof Uint8Array)) continue;
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const key = buffer.toString("base64");
      if (seen.has(key)) continue;
      seen.add(key);
      buffers.push(buffer);
    }
  }
  return { buffers, found };
}

/**
 * Reports disagreement between the two views.
 *
 * A service present in one view and absent from the other is not cosmetic: one
 * direction means "listed but not callable", the other means "callable but
 * undescribable". Both used to be invisible.
 */
function crossCheckServices(
  described: string[],
  invocable: string[],
  notes: string[],
): void {
  const describedSet = new Set(described);
  const invocableSet = new Set(invocable);

  const onlyDescribed = described.filter((n) => !invocableSet.has(n));
  const onlyInvocable = invocable.filter((n) => !describedSet.has(n));

  if (onlyDescribed.length > 0) {
    notes.push(
      `${onlyDescribed.length} service(s) are described but not invocable ` +
        `(no codecs were generated): ${onlyDescribed.join(", ")}.`,
    );
  }
  if (onlyInvocable.length > 0) {
    notes.push(
      `${onlyInvocable.length} service(s) are invocable but have no descriptor, ` +
        `so no request template can be generated: ${onlyInvocable.join(", ")}.`,
    );
  }
}

function decodeSet(buffers: Buffer[], notes: string[]): DecodedFile[] {
  const files: DecodedFile[] = [];
  for (const buffer of buffers) {
    try {
      files.push(decodeFileDescriptorProto(buffer));
    } catch (e) {
      notes.push(
        `a FileDescriptorProto could not be decoded and its symbols are ` +
          `unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return files;
}

/* ------------------------------------------------------------------ *
 * Public entry point
 * ------------------------------------------------------------------ */

export async function buildCatalog(
  endpoint: GrpcEndpoint,
): Promise<{ catalog: Catalog; packageDefinition: Record<string, unknown> }> {
  const loaded = await loadGrpc();
  const { protoLoader } = loaded;
  const notes: string[] = [];

  let packageDefinition: Record<string, unknown>;
  let fileDescriptors: DecodedFile[];
  let source: "proto" | "reflection";
  let files: string[] | undefined;

  // Narrowed on `reflection`, the discriminant of GrpcDescriptorSource. Each
  // branch therefore sees only the options that belong to it, which is what
  // removes the old "reflection wins, protoPaths ignored" note: that state can
  // no longer be constructed.
  if (endpoint.reflection === true) {
    requireCapability(loaded, "descriptorSetFromBuffer");

    const { credentials, mode, warnings } = buildCredentialsChecked(
      endpoint,
      loaded,
    );
    notes.push(...warnings);

    const reflected = await fetchFullDescriptorSet({
      address: endpoint.address,
      credentials,
      metadata: endpoint.metadata,
      timeoutMs: endpoint.reflectionTimeoutMs ?? 5000,
      channelOptions: endpoint.channelOptions,
      version: endpoint.reflectionVersion,
      host: endpoint.reflectionHost,
      maxFiles: endpoint.maxReflectionFiles,
      maxBytes: endpoint.maxReflectionBytes,
    });
    notes.push(...reflected.notes);

    if (reflected.services.length === 0) {
      throw new Error(
        `reflection is available at ${endpoint.address} (${reflected.version}) ` +
          `but no services are registered on it. Either the server registered ` +
          `only the reflection service itself, or the services you expect were ` +
          `never added to it.`,
      );
    }

    packageDefinition = protoLoader.loadFileDescriptorSetFromBuffer(
      reflected.descriptorSet,
      LOADER_OPTIONS,
    ) as unknown as Record<string, unknown>;

    // The bytes are already in hand here, so this source needs no harvesting.
    fileDescriptors = decodeFileDescriptorSet(reflected.descriptorSet);
    source = "reflection";
    files = reflected.files;
    notes.push(
      `reflection (${reflected.version}, ${mode}) returned ` +
        `${reflected.services.length} service(s) across ` +
        `${reflected.files.length} file(s).`,
    );
  } else {
    // scanProtoFiles throws on an empty result, on an empty protoPaths and on
    // an unreadable root, so none of those checks are repeated here.
    const scan = await scanProtoFiles({
      paths: endpoint.protoPaths,
      ignoreDirs: endpoint.ignoreDirs,
      followSymlinks: endpoint.followSymlinks,
      maxFiles: endpoint.maxProtoFiles,
    });
    notes.push(...scan.notes);
    files = scan.files;

    // An explicit includeDirs switches the derivation off entirely: the point of
    // passing it is to get protoc's resolution rules, and silently adding to it
    // would defeat that.
    let includeDirs: string[];
    if (endpoint.includeDirs?.length) {
      includeDirs = endpoint.includeDirs;
    } else {
      const derived = deriveIncludeDirsDetailed(scan);
      includeDirs = derived.includeDirs;
      notes.push(...derived.notes);
    }

    packageDefinition = (await protoLoader.load(scan.files, {
      ...LOADER_OPTIONS,
      includeDirs,
    })) as unknown as Record<string, unknown>;

    const harvested = harvestFileDescriptors(packageDefinition);
    if (!harvested.found) {
      throw new Error(
        `@grpc/proto-loader did not attach fileDescriptorProtos to its output, ` +
          `so no method or field metadata can be read. Upgrade to ` +
          `@grpc/proto-loader >= 0.6.0.`,
      );
    }
    fileDescriptors = decodeSet(harvested.buffers, notes);
    source = "proto";
    if (scan.files.length > 1) {
      notes.push(
        `merged ${scan.files.length} .proto file(s) from ` +
          `${endpoint.protoPaths.length} path(s).`,
      );
    }
  }

  const symbols = new Map<string, SymbolEntry>();
  const serviceDescriptors = new Map<string, unknown>();
  for (const fileDescriptor of fileDescriptors) {
    indexFile(symbols, serviceDescriptors, notes, fileDescriptor);
  }

  const services = [...serviceDescriptors.keys()].sort();
  const invocableServices = collectInvocableServices(packageDefinition);
  crossCheckServices(services, invocableServices, notes);

  if (services.length === 0 && invocableServices.length === 0) {
    notes.push(
      source === "proto"
        ? `the ${files?.length ?? 0} .proto file(s) loaded declare no services.`
        : "reflection returned descriptors that declare no services.",
    );
  }

  return {
    catalog: {
      source,
      symbols,
      services,
      invocableServices,
      serviceDescriptors,
      notes,
      files,
    },
    packageDefinition,
  };
}
