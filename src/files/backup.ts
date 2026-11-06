/**
 * Automatic snapshot + undo for files the server modifies (port of backup_manager.py).
 * Snapshots live in <dataDir>/.backups with a history.json index, newest last, max 100.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { timestamp } from "../core/audit.js";
import { isPathAllowed, realResolve } from "../core/config.js";
import { writeFileAtomic } from "./fsutil.js";
import type { Ctx } from "../core/context.js";

const MAX_BACKUPS = 100;

export interface BackupEntry {
  backup_id: string;
  original_path: string;
  backup_file: string;
  timestamp: string;
  operation: string;
  size_bytes: number;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function createBackups(ctx: Ctx) {
  const dir = path.join(ctx.cfg.dataDir, ".backups");
  const historyFile = path.join(dir, "history.json");

  const ensure = () => {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(historyFile)) fs.writeFileSync(historyFile, "[]", "utf8");
  };
  const load = (): BackupEntry[] => {
    ensure();
    try {
      const d: unknown = JSON.parse(fs.readFileSync(historyFile, "utf8"));
      return Array.isArray(d) ? (d as BackupEntry[]) : [];
    } catch {
      return [];
    }
  };
  /** Drop the oldest snapshot from the index AND from disk (a quota that only edits the index frees nothing). */
  const dropOldest = (h: BackupEntry[]): number => {
    const old = h.shift()!;
    try {
      fs.unlinkSync(path.join(dir, old.backup_file));
    } catch {
      /* already gone */
    }
    return old.size_bytes;
  };
  const save = (h: BackupEntry[]) => {
    ensure();
    while (h.length > MAX_BACKUPS) dropOldest(h);
    // keep the total under the quota; the newest snapshot always survives (undo of the latest write beats the quota)
    let total = h.reduce((n, e) => n + e.size_bytes, 0);
    while (total > ctx.cfg.backupMaxTotalBytes && h.length > 1) total -= dropOldest(h);
    writeFileAtomic(historyFile, JSON.stringify(h, null, 2));
  };

  /** A bare filename matches by name; anything with a directory part must match the full path. */
  const matches = (e: BackupEntry, query: string): boolean => {
    const q = query.trim();
    if (!/[\\/]/.test(q)) return same(path.basename(e.original_path), q);
    return same(e.original_path, realResolve(q));
  };

  function snapshot(target: string, operation = "modify"): BackupEntry | null {
    const resolved = realResolve(target);
    let size: number;
    try {
      const st = fs.statSync(resolved);
      if (!st.isFile()) return null;
      size = st.size;
    } catch {
      return null;
    }
    if (size > ctx.cfg.backupMaxFileBytes) {
      // copying a multi-GB file would stall the very write it is meant to protect; say so instead of silently losing undo
      ctx.audit("backup_manager", "SKIP_QUOTA", `Skipped snapshot for ${path.basename(resolved)} (${size} bytes exceeds single-file limit ${ctx.cfg.backupMaxFileBytes})`);
      return null;
    }
    try {
      ensure();
      const now = new Date();
      const p2 = (n: number) => String(n).padStart(2, "0");
      const id = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}_${crypto.randomBytes(3).toString("hex")}`;
      const file = `${id}_${path.basename(resolved).replace(/ /g, "_")}.bak`;
      fs.copyFileSync(resolved, path.join(dir, file));
      const entry: BackupEntry = {
        backup_id: id,
        original_path: resolved,
        backup_file: file,
        timestamp: timestamp(now),
        operation,
        size_bytes: fs.statSync(resolved).size,
      };
      const h = load();
      h.push(entry);
      save(h);
      return entry;
    } catch (e) {
      ctx.audit("backup_manager", "ERROR", `Failed snapshot for ${resolved}: ${(e as Error).message}`);
      return null;
    }
  }

  function list(p = "", limit = 20): BackupEntry[] {
    let h = load();
    if (p.trim()) h = h.filter((e) => matches(e, p));
    return h.reverse().slice(0, limit);
  }

  function restore(entry: BackupEntry): { ok: true } | { ok: false; error: string } {
    const orig = entry.original_path;
    const bak = path.join(dir, entry.backup_file);
    if (!fs.existsSync(bak)) return { ok: false, error: `Backup file missing on disk: ${entry.backup_file}` };
    if (!isPathAllowed(ctx.cfg, orig)) return { ok: false, error: `Sandbox violation: ${orig} is outside allowed directories.` };
    fs.mkdirSync(path.dirname(orig), { recursive: true });
    fs.copyFileSync(bak, orig);
    return { ok: true };
  }

  function undoLast(p = ""): Record<string, unknown> {
    const h = load();
    if (!h.length) return { success: false, error: "No backup snapshots available to undo." };
    let idx = h.length - 1;
    if (p.trim()) {
      idx = -1;
      for (let i = h.length - 1; i >= 0; i--) if (matches(h[i]!, p)) { idx = i; break; }
      if (idx < 0) return { success: false, error: `No backup found for path: ${p}` };
    }
    const entry = h[idx]!;
    try {
      const r = restore(entry);
      if (!r.ok) {
        if (r.error.startsWith("Backup file missing")) {
          h.splice(idx, 1);
          save(h);
        }
        return { success: false, error: r.error };
      }
      h.splice(idx, 1); // consume, so repeated undo walks back in time
      try {
        fs.unlinkSync(path.join(dir, entry.backup_file));
      } catch {
        /* ignore */
      }
      save(h);
      ctx.audit("undo_last", "ALLOW", `Restored ${entry.original_path} from ${entry.backup_id}`);
      return {
        success: true,
        restored_path: entry.original_path,
        restored_from_timestamp: entry.timestamp,
        backup_id: entry.backup_id,
        previous_operation: entry.operation,
        remaining_backups: h.length,
      };
    } catch (e) {
      return { success: false, error: `Failed to restore ${entry.original_path}: ${(e as Error).message}` };
    }
  }

  function restoreById(id: string): Record<string, unknown> {
    const entry = load().find((e) => e.backup_id === id.trim());
    if (!entry) return { success: false, error: `Backup ID not found: ${id}` };
    try {
      const r = restore(entry);
      if (!r.ok) return { success: false, error: r.error };
      ctx.audit("restore_by_id", "ALLOW", `Restored ${entry.original_path} from ${id}`);
      return { success: true, restored_path: entry.original_path, restored_from_timestamp: entry.timestamp, backup_id: id };
    } catch (e) {
      return { success: false, error: `Restore failed: ${(e as Error).message}` };
    }
  }

  return { snapshot, list, undoLast, restoreById, dir };
}

export type Backups = ReturnType<typeof createBackups>;
