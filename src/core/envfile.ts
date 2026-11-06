import fs from "node:fs";
import { writeFileAtomic } from "../files/fsutil.js";

/** Rewrite KEY=value lines in .env, keeping every other line (comments, unknown keys) untouched. null removes a key. */
export function updateEnvFile(file: string, updates: Record<string, string | null>): void {
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/);
    if (lines[lines.length - 1] === "") lines.pop();
  } catch {
    /* new file */
  }
  const pending = new Map(Object.entries(updates));
  const out: string[] = [];
  for (const line of lines) {
    const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (key && pending.has(key)) {
      const v = pending.get(key)!;
      pending.delete(key);
      if (v !== null) out.push(`${key}=${v}`);
    } else out.push(line);
  }
  for (const [k, v] of pending) if (v !== null) out.push(`${k}=${v}`);
  writeFileAtomic(file, out.join("\n") + "\n");
}
