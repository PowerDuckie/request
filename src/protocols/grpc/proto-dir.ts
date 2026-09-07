import { readdir, realpath, stat } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export interface CollectProtoOptions {
  paths: string[];
  /** Directory names skipped during traversal. Defaults below. */
  ignoreDirs?: string[];
  /**
   * Follow symlinks. Off by default: a link cycle is common in monorepos and
   * following one silently doubles or hangs the scan. Cycles are detected by
   * real path either way, so enabling this is safe.
   */
  followSymlinks?: boolean;
  /** Cap on files collected, to bound a mistakenly broad root. Default 5000. */
  maxFiles?: number;
}

export interface ProtoScanResult {
  /** Absolute .proto paths, de-duplicated, sorted by byte order. */
  files: string[];
  /** Roots as given, resolved to absolute directories. */
  rootDirs: string[];
  /** Roots that pointed at a single file rather than a tree. */
  fileRoots: string[];
  /** Non-fatal facts: skipped links, unreadable dirs, caps hit. */
  notes: string[];
}

const DEFAULT_IGNORES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".venv",
];
const DEFAULT_MAX_FILES = 5000;

function isProtoName(name: string): boolean {
  // Case-insensitive: on a case-insensitive filesystem a mixed-case name exists
  // but would never match a strict suffix test, so the file would vanish.
  return name.toLowerCase().endsWith(".proto");
}

/** Turns an fs error into a sentence that says what to fix. */
function explainFsError(path: string, error: unknown): string {
  const code = (error as { code?: string } | undefined)?.code;
  switch (code) {
    case "ENOENT":
      return `proto path does not exist: ${path}`;
    case "EACCES":
    case "EPERM":
      return `proto path is not readable (permission denied): ${path}`;
    case "ENOTDIR":
      return `a component of the proto path is not a directory: ${path}`;
    case "ELOOP":
      return `proto path contains a symlink loop: ${path}`;
    case "ENAMETOOLONG":
      return `proto path is too long: ${path}`;
    default:
      return (
        `proto path could not be read: ${path}` +
        (code ? ` (${code})` : "") +
        (error instanceof Error ? ` — ${error.message}` : "")
      );
  }
}

/**
 * Expands a mix of files and directories into a de-duplicated, sorted list of
 * absolute .proto paths.
 *
 * The sort is load-order significant: when two files declare the same
 * fully-qualified symbol, proto-loader lets one of them win without complaint,
 * so a stable order is what makes such a conflict reproducible rather than
 * dependent on directory iteration order.
 */
export async function scanProtoFiles(
  options: CollectProtoOptions,
): Promise<ProtoScanResult> {
  if (options.paths.length === 0) {
    throw new Error("protoPaths is empty; nothing to load.");
  }

  const ignore = new Set(options.ignoreDirs ?? DEFAULT_IGNORES);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const files = new Set<string>();
  const rootDirs: string[] = [];
  const fileRoots: string[] = [];
  const notes: string[] = [];
  /** Real paths of directories already walked, so symlink cycles terminate. */
  const visited = new Set<string>();
  let capped = false;

  const addFile = (abs: string): void => {
    if (files.size >= maxFiles) {
      if (!capped) {
        capped = true;
        notes.push(
          `stopped after ${maxFiles} .proto files; pass maxFiles or a narrower ` +
            `protoPaths if the tree really is this large.`,
        );
      }
      return;
    }
    files.add(abs);
  };

  const walkDir = async (abs: string, viaLink: boolean): Promise<void> => {
    let real: string;
    try {
      real = await realpath(abs);
    } catch (error) {
      notes.push(explainFsError(abs, error));
      return;
    }
    if (visited.has(real)) {
      if (viaLink) {
        notes.push(
          `skipped ${abs}: it resolves to ${real}, which was already scanned.`,
        );
      }
      return;
    }
    visited.add(real);

    // Annotated explicitly: readdir has a Buffer-returning overload, and
    // inferring from ReturnType picks it, which types entry.name as a Buffer.
    let entries: Dirent[];
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (error) {
      // One unreadable subdirectory must not void the whole scan; the files we
      // did find are still usable, and the gap is reported.
      notes.push(explainFsError(abs, error));
      return;
    }

    for (const entry of entries) {
      if (capped) return;
      const child = join(abs, entry.name);

      if (entry.isSymbolicLink()) {
        if (!options.followSymlinks) {
          notes.push(
            `skipped symlink ${child} (followSymlinks is off). If your proto ` +
              `tree links to shared definitions, enable followSymlinks or add ` +
              `the target to protoPaths.`,
          );
          continue;
        }
        let info: Stats;
        try {
          info = await stat(child);
        } catch (error) {
          notes.push(explainFsError(child, error));
          continue;
        }
        if (info.isDirectory()) {
          if (!ignore.has(entry.name)) await walkDir(child, true);
        } else if (info.isFile() && isProtoName(entry.name)) {
          addFile(resolve(child));
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (!ignore.has(entry.name)) await walkDir(child, false);
        continue;
      }
      if (entry.isFile() && isProtoName(entry.name)) addFile(resolve(child));
    }
  };

  for (const path of options.paths) {
    const abs = resolve(path);
    let info: Stats;
    try {
      info = await stat(abs);
    } catch (error) {
      // A root that cannot be read is fatal: the caller named it explicitly, so
      // silently producing a smaller file set would be answering a different
      // question than the one asked.
      throw new Error(explainFsError(path, error), { cause: error });
    }

    if (info.isFile()) {
      if (!isProtoName(abs)) {
        throw new Error(
          `not a .proto file: ${path}. protoPaths accepts .proto files and ` +
            `directories containing them.`,
        );
      }
      addFile(abs);
      fileRoots.push(abs);
      continue;
    }
    if (!info.isDirectory()) {
      throw new Error(`proto path is neither a file nor a directory: ${path}`);
    }
    rootDirs.push(abs);
    await walkDir(abs, false);
  }

  if (files.size === 0) {
    const hint = notes.length
      ? ` Some entries were skipped: ${notes[0]}`
      : ` Checked for *.proto, skipping ${[...ignore].join(", ")}.`;
    throw new Error(
      `no .proto files found under: ${options.paths.join(", ")}.${hint}`,
    );
  }

  return { files: [...files].sort(), rootDirs, fileRoots, notes };
}

/** Back-compatible shape for callers that only want the paths. */
export async function collectProtoFiles(
  options: CollectProtoOptions,
): Promise<string[]> {
  return (await scanProtoFiles(options)).files;
}

export interface IncludeDirsResult {
  includeDirs: string[];
  notes: string[];
}

function isUnder(child: string, parent: string): boolean {
  const p = parent.endsWith(sep) ? parent : parent + sep;
  return child === parent || child.startsWith(p);
}

/**
 * Derives include dirs so that `import "common/types.proto"` resolves.
 *
 * A bare directory scan without this loads files that cannot resolve their own
 * imports. But note what the fallback costs: adding every containing directory
 * makes `import "types.proto"` resolve from any directory in the tree, so a
 * proto that `protoc -I <root>` would reject can load here. That is a guess in
 * the user's favour, and guesses that loosen resolution have to be announced —
 * otherwise this library reports a proto tree as healthy when the real build
 * will fail. Pass includeDirs explicitly to switch the guess off.
 */
export function deriveIncludeDirsDetailed(
  scan: ProtoScanResult,
): IncludeDirsResult {
  const notes: string[] = [];
  const includeDirs = new Set<string>();

  for (const dir of scan.rootDirs) includeDirs.add(dir);
  // A root that names a single file contributes its parent, not itself: a file
  // path is not a search root, and adding one silently does nothing.
  for (const file of scan.fileRoots) includeDirs.add(dirname(file));

  const roots = [...includeDirs];
  const extra: string[] = [];
  for (const file of scan.files) {
    const dir = dirname(file);
    if (roots.some((root) => isUnder(dir, root))) continue;
    if (includeDirs.has(dir)) continue;
    includeDirs.add(dir);
    extra.push(dir);
  }

  if (extra.length > 0) {
    notes.push(
      `${extra.length} directory(ies) outside the given protoPaths were added ` +
        `as include roots so their imports resolve: ` +
        `${extra.slice(0, 3).join(", ")}${extra.length > 3 ? ", …" : ""}. ` +
        `Imports are therefore resolved more loosely than protoc would; ` +
        `pass includeDirs explicitly for exact behaviour.`,
    );
  }

  return { includeDirs: [...includeDirs].sort(), notes };
}

/** Back-compatible signature. Prefer the detailed variant to keep the notes. */
export function deriveIncludeDirs(
  protoFiles: string[],
  roots: string[],
): string[] {
  const rootDirs: string[] = [];
  const fileRoots: string[] = [];
  for (const root of roots) {
    const abs = resolve(root);
    if (isProtoName(abs)) fileRoots.push(abs);
    else rootDirs.push(abs);
  }
  return deriveIncludeDirsDetailed({
    files: protoFiles,
    rootDirs,
    fileRoots,
    notes: [],
  }).includeDirs;
}
