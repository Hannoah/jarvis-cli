/**
 * Recurring tasks: Windows Task Scheduler (schtasks) or the user's crontab elsewhere. All tasks are namespaced `Jarvis_*`.
 *
 * The (already policy-checked) command is stored in a script under <project>/.scheduled/, and the task only runs that file.
 * The old version embedded the command inside the /TR string, where an embedded quote could change how it was parsed
 * after the policy had approved it.
 */
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Ctx } from "../core/context.js";
import { psExecutable } from "../security/policy.js";
import { decodeText } from "../files/textio.js";

const isWin = process.platform === "win32";
const TR_LIMIT = 261; // schtasks /TR hard limit

export function normalizeTaskName(raw: string): string {
  const clean = raw.trim().replace(/[^A-Za-z0-9_\-가-힣]/g, "_");
  if (!clean) throw new Error("Task name cannot be empty.");
  return clean.startsWith("Jarvis_") ? clean : `Jarvis_${clean}`;
}

const run = (cmd: string, args: string[], input?: string, timeout = 15000) => {
  const r = spawnSync(cmd, args, { timeout, windowsHide: true, input });
  return { ok: r.status === 0, out: decodeText(r.stdout ?? Buffer.alloc(0)).text.trim(), err: decodeText(r.stderr ?? Buffer.alloc(0)).text.trim(), error: r.error };
};

const runAsync = (cmd: string, args: string[], timeout = 60000): Promise<{ ok: boolean; out: string; err: string; error?: Error }> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        out: decodeText(stdout ?? Buffer.alloc(0)).text.trim(),
        err: decodeText(stderr ?? Buffer.alloc(0)).text.trim(),
        error: err ?? undefined,
      });
    });
  });

const scriptsDir = (ctx: Ctx) => path.join(ctx.cfg.dataDir, ".scheduled");
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export interface TaskSpec {
  name: string;
  cwd: string;
  command: string;
  schedule: "DAILY" | "HOURLY" | "MINUTE" | "ONCE";
  startTime: string;
  interval: number;
}

export function createTask(ctx: Ctx, t: TaskSpec): { ok: true; message: string } | { ok: false; error: string } {
  fs.mkdirSync(scriptsDir(ctx), { recursive: true });
  const script = path.join(scriptsDir(ctx), `${t.name}.ps1`);
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  // UTF-8 with BOM: Windows PowerShell 5.1 reads BOM-less files as ANSI and garbles Korean.
  fs.writeFileSync(script, `﻿Set-Location -LiteralPath ${q(t.cwd)}\r\n${t.command}\r\n`, "utf8");
  const mo = Math.max(1, Math.min(t.interval, 1440));

  if (isWin) {
    const tr = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}"`;
    if (tr.length > TR_LIMIT) {
      fs.rmSync(script, { force: true });
      return { ok: false, error: `Install path is too long for Task Scheduler (${tr.length} > ${TR_LIMIT} chars). Move the Jarvis folder to a shorter path.` };
    }
    const args = ["/Create", "/TN", t.name, "/TR", tr, "/SC", t.schedule, "/ST", t.startTime, "/F"];
    if (t.schedule !== "ONCE" && mo > 1) args.push("/MO", String(mo));
    const r = run("schtasks", args);
    if (!r.ok) {
      fs.rmSync(script, { force: true });
      return { ok: false, error: r.err || r.out || String(r.error) };
    }
    return { ok: true, message: r.out };
  }

  if (t.schedule === "ONCE") {
    fs.rmSync(script, { force: true });
    return { ok: false, error: "ONCE is only supported on Windows; use DAILY/HOURLY/MINUTE on this OS." };
  }
  const [hh, mm] = t.startTime.split(":").map(Number) as [number, number];
  const when = t.schedule === "MINUTE" ? `*/${mo} * * * *` : t.schedule === "HOURLY" ? `${mm} */${mo} * * *` : `${mm} ${hh} */${mo} * *`;
  const line = `${when} cd ${shQuote(t.cwd)} && ${psExecutable()} -NoProfile -File ${shQuote(script)} # ${t.name}`;
  const cur = run("crontab", ["-l"]);
  const kept = (cur.ok ? cur.out.split("\n") : []).filter((l) => l && !l.endsWith(`# ${t.name}`));
  const w = run("crontab", ["-"], [...kept, line].join("\n") + "\n");
  if (!w.ok) {
    fs.rmSync(script, { force: true });
    return { ok: false, error: w.err || String(w.error) };
  }
  return { ok: true, message: `Installed in crontab: ${when}` };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export async function listTasks(): Promise<{ ok: true; tasks: { task_name: string; next_run_time: string; status: string }[] } | { ok: false; error: string }> {
  if (isWin) {
    // /Query enumerates every task on the machine (hundreds on a managed PC) and can exceed 15 s under load
    const r = await runAsync("schtasks", ["/Query", "/FO", "CSV", "/NH"], 90000);
    if (r.error) return { ok: false, error: String(r.error) };
    const tasks = r.out
      .split(/\r?\n/)
      .map(parseCsvLine)
      .filter((row) => row.length >= 3 && row[0]!.replace(/^\\+/, "").startsWith("Jarvis_"))
      .map((row) => ({ task_name: row[0]!.replace(/^\\+/, ""), next_run_time: row[1]!, status: row[2]! }));
    return { ok: true, tasks };
  }
  const r = await runAsync("crontab", ["-l"], 15000);
  const tasks = (r.ok ? r.out.split("\n") : [])
    .map((l) => /# (Jarvis_\S+)$/.exec(l)?.[1])
    .filter((n): n is string => !!n)
    .map((n) => ({ task_name: n, next_run_time: "", status: "scheduled" }));
  return { ok: true, tasks };
}

export function deleteTask(ctx: Ctx, name: string): { ok: true; message: string } | { ok: false; error: string } {
  let message = "";
  if (isWin) {
    const r = run("schtasks", ["/Delete", "/TN", name, "/F"]);
    if (!r.ok) return { ok: false, error: r.err || r.out || String(r.error) };
    message = r.out;
  } else {
    const cur = run("crontab", ["-l"]);
    const kept = (cur.ok ? cur.out.split("\n") : []).filter((l) => l && !l.endsWith(`# ${name}`));
    const w = run("crontab", ["-"], kept.join("\n") + (kept.length ? "\n" : ""));
    if (!w.ok) return { ok: false, error: w.err || String(w.error) };
    message = `Removed ${name} from crontab.`;
  }
  fs.rmSync(path.join(scriptsDir(ctx), `${name}.ps1`), { force: true });
  return { ok: true, message };
}
