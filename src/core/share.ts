import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isResolvedPathAllowed, protectionOfResolved, realResolve, type Config } from "./config.js";

export interface SharedFileEntry {
  token: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  expiresAt: number;
  downloadCount: number;
  oneTime: boolean;
}

// In-memory token store for temporary file downloads (TTL default: 10 minutes)
const shares = new Map<string, SharedFileEntry>();

// Purge expired tokens every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of shares.entries()) {
    if (now > entry.expiresAt) shares.delete(token);
  }
}, 60_000).unref();

export function createShareToken(
  filePath: string,
  cfg: Config,
  options: { ttlMs?: number; oneTime?: boolean } = {}
): SharedFileEntry {
  const resolved = realResolve(filePath);

  // 1. Enforce sandbox boundary: must be inside approved folders
  if (!isResolvedPathAllowed(cfg, resolved)) {
    throw new Error(`Access denied: '${resolved}' is outside allowed directories.`);
  }

  // 2. Secret and server state files are protected
  const prot = protectionOfResolved(cfg, resolved);
  if (prot === "secret" || prot === "state") {
    throw new Error(`Access denied: '${resolved}' is a protected Jarvis server file.`);
  }

  // 3. Ensure file exists and is a regular file
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`Cannot share: "${filePath}" is not a regular file.`);

  // 4. Generate high-entropy secure token (48 hex chars)
  const token = crypto.randomBytes(24).toString("hex");
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  const entry: SharedFileEntry = {
    token,
    filePath: resolved,
    fileName: path.basename(resolved),
    fileSize: stat.size,
    expiresAt: Date.now() + ttlMs,
    downloadCount: 0,
    oneTime: options.oneTime ?? false,
  };

  shares.set(token, entry);
  return entry;
}

export function getSharedFile(token: string): SharedFileEntry | null {
  const entry = shares.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    shares.delete(token);
    return null;
  }
  return entry;
}

export function recordDownload(token: string): void {
  const entry = shares.get(token);
  if (entry) {
    entry.downloadCount++;
    if (entry.oneTime) shares.delete(token);
  }
}

export function clearSharesForTest(): void {
  shares.clear();
}
