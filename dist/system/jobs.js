/** Background jobs: long-running commands (dev servers, builds) with a rolling output buffer. */
import { spawn, spawnSync } from "node:child_process";
import { psExecutable } from "../security/policy.js";
const MAX_LINES = 2000;
const hhmmss = () => new Date().toTimeString().slice(0, 8);
class Job {
    id;
    name;
    command;
    workdir;
    proc;
    lines = [];
    startedAt = Date.now();
    endedAt = null;
    exitCode = null;
    partial = { out: "", err: "" };
    constructor(id, name, command, workdir, proc) {
        this.id = id;
        this.name = name;
        this.command = command;
        this.workdir = workdir;
        this.proc = proc;
        const feed = (kind) => (chunk) => {
            const text = this.partial[kind] + chunk.toString("utf8");
            const parts = text.split(/\r?\n/);
            this.partial[kind] = parts.pop() ?? "";
            for (const l of parts)
                this.push(l);
        };
        proc.stdout?.on("data", feed("out"));
        proc.stderr?.on("data", feed("err"));
        proc.on("error", (e) => this.push(`[STREAM_ERROR] ${e.message}`));
        proc.on("close", (code) => {
            for (const k of ["out", "err"])
                if (this.partial[k])
                    this.push(this.partial[k]);
            this.exitCode = code ?? -1;
            this.endedAt ??= Date.now();
        });
    }
    push(line) {
        this.lines.push(`[${hhmmss()}] ${line}`);
        // Chunked compaction: shift() per line is O(n) for chatty jobs; dropping a chunk at a
        // time once over the cap is amortized O(1) while keeping `lines` ordered and capped.
        if (this.lines.length > MAX_LINES)
            this.lines.splice(0, this.lines.length - (MAX_LINES - 256));
    }
    get status() {
        if (this.exitCode === null)
            return "running";
        return this.exitCode === 0 ? "completed" : `failed (exit ${this.exitCode})`;
    }
    summary() {
        return {
            job_id: this.id,
            name: this.name,
            command: this.command,
            workdir: this.workdir,
            pid: this.proc.pid,
            status: this.status,
            returncode: this.exitCode,
            elapsed_sec: Math.round(((this.endedAt ?? Date.now()) - this.startedAt) / 100) / 10,
            buffered_lines: this.lines.length,
        };
    }
    kill() {
        if (!this.proc.pid || this.exitCode !== null)
            return;
        try {
            if (process.platform === "win32")
                spawnSync("taskkill", ["/F", "/T", "/PID", String(this.proc.pid)], { timeout: 10000, windowsHide: true });
            else
                process.kill(-this.proc.pid, "SIGTERM");
        }
        catch {
            this.proc.kill();
        }
        this.endedAt = Date.now();
    }
}
const MAX_JOBS = 100;
export function createJobs() {
    const jobs = new Map();
    let counter = 0;
    return {
        start(command, workdir, name) {
            if (jobs.size >= MAX_JOBS) {
                // Finished jobs otherwise accumulate forever (each holding up to 2000 lines).
                // Drop the oldest finished ones first (Map iterates in insertion order); running jobs are never evicted.
                for (const [id, j] of jobs) {
                    if (jobs.size < MAX_JOBS)
                        break;
                    if (j.exitCode !== null)
                        jobs.delete(id);
                }
            }
            const wrapped = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`;
            const proc = spawn(psExecutable(), ["-NoProfile", "-NonInteractive", "-Command", wrapped], {
                cwd: workdir,
                windowsHide: true,
                detached: process.platform !== "win32",
                stdio: ["ignore", "pipe", "pipe"],
            });
            const id = `job_${++counter}`;
            const job = new Job(id, name.trim() || command.slice(0, 40), command, workdir, proc);
            jobs.set(id, job);
            return job.summary();
        },
        get: (id) => jobs.get(id.trim()),
        list: () => [...jobs.values()].map((j) => j.summary()),
    };
}
