import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface CollectProtoOptions {
  paths: string[];
  ignoreDirs?: string[];
  followSymlinks?: boolean;
}

const DEFAULT_IGNORES = ["node_modules", ".git", "dist", "build"];

/**
 * Expands a mix of files and directories into a de-duplicated, sorted list of
 * absolute .proto paths.
 *
 * The sort is load-order significant: when two files declare the same
 * fully-qualified symbol, proto-loader silently lets the later one win, so a
 * stable order is what makes such a conflict reproducible instead of flaky.
 */
export async function collectProtoFiles(
  options: CollectProtoOptions,
): Promise<string[]> {
  const ignore = new Set(options.ignoreDirs ?? DEFAULT_IGNORES);
  const found = new Set<string>();
  const seenDirs = new Set<string>();

  const walk = async (target: string): Promise<void> => {
    const abs = resolve(target);
    const info = await stat(abs).catch(() => undefined);
    if (!info) throw new Error(`proto path does not exist: ${target}`);

    if (info.isFile()) {
      if (!abs.endsWith(".proto"))
        throw new Error(`not a .proto file: ${target}`);
      found.add(abs);
      return;
    }
    if (!info.isDirectory()) return;
    if (seenDirs.has(abs)) return;
    seenDirs.add(abs);

    for (const entry of await readdir(abs, { withFileTypes: true })) {
      const child = join(abs, entry.name);
      if (entry.isSymbolicLink()) {
        if (options.followSymlinks) await walk(child);
        continue;
      }
      if (entry.isDirectory()) {
        if (!ignore.has(entry.name)) await walk(child);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".proto")) found.add(child);
    }
  };

  for (const p of options.paths) await walk(p);

  if (found.size === 0) {
    throw new Error(`no .proto files found under: ${options.paths.join(", ")}`);
  }
  return [...found].sort();
}

/**
 * Derives include dirs so that `import "common/types.proto"` resolves.
 * A bare directory scan without this loads files that cannot resolve their own
 * imports. Explicit includeDirs from the caller always take precedence.
 */
export function deriveIncludeDirs(
  protoFiles: string[],
  roots: string[],
): string[] {
  const dirs = new Set<string>();
  for (const root of roots) dirs.add(resolve(root));
  for (const file of protoFiles) dirs.add(dirname(file));
  return [...dirs].sort();
}
