import type { App } from "obsidian";

/**
 * Syncthing conflict copies look like:
 *   tasks.json.sync-conflict-20240101-120000-ABCDEF12
 *   tasks.sync-conflict-20240101-120000-ABCDEF12.json
 */
const CONFLICT_RE = /\.sync-conflict-\d{8}-\d{6}-[A-Za-z0-9]+/;

export function isSyncConflictName(name: string): boolean {
  return CONFLICT_RE.test(name);
}

/** Reconstruct the canonical file name from a conflict copy name. */
export function baseNameFromConflict(name: string): string {
  const m = /^(.*?)\.sync-conflict-\d{8}-\d{6}-[A-Za-z0-9]+(.*)$/.exec(name);
  if (!m) return name;
  const head = m[1];
  const tail = m[2] ?? "";
  if (tail.startsWith(".") && !/\.[A-Za-z0-9]+$/.test(head)) {
    return head + tail;
  }
  return head;
}

interface ListedFile {
  path: string;
  name: string;
  mtime: number;
  content: string;
}

async function readEntry(app: App, path: string): Promise<ListedFile | null> {
  try {
    const content = await app.vault.adapter.read(path);
    const stat = await app.vault.adapter.stat(path);
    const name = path.split("/").pop() ?? path;
    return { path, name, mtime: stat?.mtime ?? 0, content };
  } catch {
    return null;
  }
}

/**
 * Resolve Syncthing conflict copies under the given directories.
 * Keeps the newest version as the canonical file and deletes the rest.
 * Returns the number of conflict files removed.
 */
export async function cleanupSyncConflictFiles(
  app: App,
  dirs: string[] = [],
): Promise<number> {
  let removed = 0;

  for (const dir of dirs) {
    let listing: { files: string[] };
    try {
      listing = await app.vault.adapter.list(dir || "/");
    } catch {
      continue;
    }

    // Group paths by canonical base name
    const byBase = new Map<string, string[]>();
    for (const path of listing.files) {
      const name = path.split("/").pop() ?? path;
      const isConflict = isSyncConflictName(name);
      const base = isConflict ? baseNameFromConflict(name) : name;
      const list = byBase.get(base) ?? [];
      list.push(path);
      byBase.set(base, list);
    }

    for (const [base, paths] of byBase) {
      const hasConflict = paths.some((p) => isSyncConflictName(p.split("/").pop() ?? p));
      if (!hasConflict) continue;

      const entries: ListedFile[] = [];
      for (const path of paths) {
        const entry = await readEntry(app, path);
        if (entry) entries.push(entry);
      }
      if (entries.length === 0) continue;

      // Newest mtime wins
      const winner = [...entries].sort((a, b) => b.mtime - a.mtime)[0];
      const target = dir ? `${dir}/${base}` : base;

      // Ensure canonical file holds the winning content
      const winnerIsCanonical = winner.path === target && !isSyncConflictName(winner.name);
      if (!winnerIsCanonical) {
        try {
          await app.vault.adapter.write(target, winner.content);
        } catch (e) {
          console.error(`[syncConflicts] Failed to write ${target}:`, e);
          continue;
        }
      }

      // Delete conflict copies and any losing non-canonical copy
      for (const entry of entries) {
        if (entry.path === target && !isSyncConflictName(entry.name)) continue;
        try {
          await app.vault.adapter.remove(entry.path);
          removed++;
        } catch (e) {
          console.error(`[syncConflicts] Failed to remove ${entry.path}:`, e);
        }
      }
    }
  }

  if (removed > 0) {
    console.debug(`[syncConflicts] Removed ${removed} conflict file(s)`);
  }
  return removed;
}
