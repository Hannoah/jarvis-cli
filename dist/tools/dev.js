/** Developer power tools: undo/backups, background jobs, git, code symbols, web, documents, scheduled tasks. */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readDocumentText } from "../files/docs.js";
import { decodeBody, htmlToMarkdown, safeFetch } from "../security/net.js";
import { createTask, deleteTask, listTasks, normalizeTaskName } from "../system/scheduler.js";
import { listSymbols } from "../files/symbols.js";
import { gateCommand } from "./terminal.js";
import { json, mutating, READ_ONLY, resolveInWorkdir, SandboxViolationError } from "./common.js";
const MAX_DOC_BYTES = 50 * 1024 * 1024;
function runGit(args, cwd, timeoutMs = 30000) {
    return new Promise((resolve) => {
        execFile("git", ["-c", "core.quotepath=false", ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) => {
            if (err && err.code === "ENOENT") {
                const hint = process.platform === "win32" ? "`winget install -e --id Git.Git`" : process.platform === "darwin" ? "`brew install git` (또는 `xcode-select --install`)" : "패키지 관리자로 git";
                return resolve({ ok: false, out: "", err: `현재 PC에 Git CLI가 설치되어 있지 않습니다. ${hint} 명령어로 설치할 수 있습니다.` });
            }
            resolve({ ok: !err, out: stdout.replace(/[\r\n]+$/, ""), err: (stderr || (err ? err.message : "")).trim() });
        });
    });
}
export function registerDevTools(mcp, ctx) {
    const { cfg, audit } = ctx;
    const MUT = mutating(cfg);
    /** Resolve a workdir-relative path or return the error object for the caller. */
    const resolve = (p, tool, mode = "read") => {
        try {
            return { path: resolveInWorkdir(ctx, p, tool, mode) };
        }
        catch (e) {
            if (e instanceof SandboxViolationError || e instanceof Error)
                return { success: false, error: e.message };
            throw e;
        }
    };
    // ---- 1. Undo / backups -----------------------------------------------------------------
    mcp.registerTool("undo_last_edit", {
        description: "Undo the most recent file write or edit (reverts to automatic pre-modification snapshot). " +
            "If `path` is provided, reverts the latest change to that specific file. If omitted/empty, reverts the latest modified file across the workspace.",
        inputSchema: { path: z.string().default("") },
        annotations: MUT,
    }, async ({ path: p }) => {
        if (!cfg.enableWrite)
            return json({ success: false, error: "File write/undo disabled by policy." });
        return json(ctx.backups.undoLast(p));
    });
    mcp.registerTool("list_file_backups", {
        description: "List automatic file backup snapshots created before write_file / edit_file operations.",
        inputSchema: { path: z.string().default(""), limit: z.number().int().default(20) },
        annotations: READ_ONLY,
    }, async ({ path: p, limit }) => {
        const items = ctx.backups.list(p, Math.max(1, Math.min(limit, 100)));
        return json({ count: items.length, backups: items });
    });
    mcp.registerTool("restore_file_backup", {
        description: "Restore a file to a specific snapshot version using its `backup_id` from `list_file_backups`.",
        inputSchema: { backup_id: z.string() },
        annotations: MUT,
    }, async ({ backup_id }) => {
        if (!cfg.enableWrite)
            return json({ success: false, error: "File restore disabled by policy." });
        return json(ctx.backups.restoreById(backup_id));
    });
    // ---- 2. Background jobs -----------------------------------------------------------------
    mcp.registerTool("start_background_job", {
        description: "Start a long-running command in the background (e.g. dev server, build, training) and return a job_id.",
        inputSchema: { command: z.string(), workdir: z.string().default(""), name: z.string().default("") },
        annotations: MUT,
    }, async ({ command, workdir, name }) => {
        if (!cfg.enableTerminal)
            return json({ success: false, error: "Terminal execution is disabled by policy." });
        const r = resolve(workdir, "start_background_job");
        if ("error" in r)
            return json(r);
        if (!fs.existsSync(r.path) || !fs.statSync(r.path).isDirectory())
            return json({ success: false, error: `Working directory does not exist: ${r.path}` });
        const denied = await gateCommand(ctx, "start_background_job", command, r.path);
        if (denied)
            return json({ success: false, error: denied });
        try {
            const job = ctx.jobs.start(command, r.path, name);
            audit("start_background_job", "ALLOW", `${job.job_id} (PID ${job.pid}): ${command}`);
            await new Promise((res) => setTimeout(res, 200));
            return json({ success: true, ...ctx.jobs.get(job.job_id).summary() });
        }
        catch (e) {
            return json({ success: false, error: `Failed to start background job: ${e.message}` });
        }
    });
    mcp.registerTool("read_job_output", {
        description: "Read recent stdout/stderr log lines and status from a background job.",
        inputSchema: { job_id: z.string(), tail_lines: z.number().int().default(100) },
        annotations: READ_ONLY,
    }, async ({ job_id, tail_lines }) => {
        const job = ctx.jobs.get(job_id);
        if (!job)
            return json({ success: false, error: `Job not found: ${job_id}` });
        const n = Math.max(1, Math.min(tail_lines, 2000));
        return json({ success: true, ...job.summary(), output: job.lines.slice(-n).join("\n") });
    });
    mcp.registerTool("stop_job", {
        description: "Terminate a running background job and its child process tree.",
        inputSchema: { job_id: z.string() },
        annotations: MUT,
    }, async ({ job_id }) => {
        const job = ctx.jobs.get(job_id);
        if (!job)
            return json({ success: false, error: `Job not found: ${job_id}` });
        if (job.exitCode !== null)
            return json({ success: true, message: `Job ${job_id} had already finished.`, ...job.summary() });
        job.kill();
        audit("stop_job", "ALLOW", `Stopped ${job_id} (PID ${job.proc.pid})`);
        await new Promise((res) => setTimeout(res, 300));
        return json({ success: true, message: `Job ${job_id} terminated.`, ...job.summary() });
    });
    mcp.registerTool("list_background_jobs", { description: "List all background jobs and their current status.", annotations: READ_ONLY }, async () => {
        const jobs = ctx.jobs.list();
        return json({ count: jobs.length, jobs });
    });
    // ---- 3. Git ---------------------------------------------------------------------------------
    mcp.registerTool("git_status", {
        description: "Get structured Git repository status (branch, staged, modified, untracked files).",
        inputSchema: { repo_path: z.string().default("") },
        annotations: READ_ONLY,
    }, async ({ repo_path }) => {
        const r = resolve(repo_path, "git_status");
        if ("error" in r)
            return json(r);
        const st = await runGit(["status", "--porcelain=v1", "-uall"], r.path);
        if (!st.ok)
            return json({ success: false, error: st.err || "Not a git repository." });
        let branch = (await runGit(["branch", "--show-current"], r.path)).out;
        if (!branch)
            branch = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], r.path)).out;
        branch = branch.trim() || "HEAD (unborn)";
        const staged = [];
        const modified = [];
        const untracked = [];
        for (const line of st.out.split(/\r?\n/)) {
            if (line.length < 4)
                continue;
            const xy = line.slice(0, 2);
            const file = line.slice(3);
            if (xy === "??")
                untracked.push(file);
            else {
                if (!" ?".includes(xy[0]))
                    staged.push({ status: xy[0], path: file });
                if (!" ?".includes(xy[1]))
                    modified.push({ status: xy[1], path: file });
            }
        }
        return json({
            success: true,
            repository: r.path,
            branch,
            is_clean: !staged.length && !modified.length && !untracked.length,
            staged,
            modified,
            untracked,
        });
    });
    mcp.registerTool("git_diff", {
        description: "Get Git diff for working tree or staged changes.",
        inputSchema: { repo_path: z.string().default(""), target: z.string().default(""), staged: z.boolean().default(false), max_chars: z.number().int().default(20000) },
        annotations: READ_ONLY,
    }, async ({ repo_path, target, staged, max_chars }) => {
        const r = resolve(repo_path, "git_diff");
        if ("error" in r)
            return json(r);
        const base = ["diff", ...(staged ? ["--staged"] : [])];
        const pathspec = target.trim() ? ["--", target.trim()] : []; // after `--`, so it can never be read as an option
        const d = await runGit([...base, ...pathspec], r.path);
        if (!d.ok)
            return json({ success: false, error: d.err });
        const stat = await runGit([...base, "--stat", ...pathspec], r.path);
        const truncated = d.out.length > max_chars;
        return json({
            success: true,
            repository: r.path,
            staged,
            stat: stat.out,
            diff: truncated ? `${d.out.slice(0, max_chars)}\n... [Truncated at ${max_chars} chars]` : d.out,
            truncated,
        });
    });
    mcp.registerTool("git_log", {
        description: "Get structured recent Git commit history.",
        inputSchema: { repo_path: z.string().default(""), max_count: z.number().int().default(10) },
        annotations: READ_ONLY,
    }, async ({ repo_path, max_count }) => {
        const r = resolve(repo_path, "git_log");
        if ("error" in r)
            return json(r);
        const n = Math.max(1, Math.min(max_count, 50));
        const l = await runGit(["log", `-n${n}`, "--date=iso", "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s"], r.path);
        if (!l.ok)
            return json({ success: false, error: l.err });
        const commits = l.out
            .split(/\r?\n/)
            .map((line) => line.split("\x1f"))
            .filter((p) => p.length === 5)
            .map((p) => ({ hash: p[0], short_hash: p[1], author: p[2], date: p[3], message: p[4] }));
        return json({ success: true, repository: r.path, count: commits.length, commits });
    });
    mcp.registerTool("git_commit", {
        description: "Stage changes (if add_all=True) and create a Git commit.",
        inputSchema: { message: z.string(), repo_path: z.string().default(""), add_all: z.boolean().default(false) },
        annotations: MUT,
    }, async ({ message, repo_path, add_all }) => {
        if (!cfg.enableWrite)
            return json({ success: false, error: "Write operations are disabled by policy." });
        if (!message.trim())
            return json({ success: false, error: "Commit message cannot be empty." });
        const r = resolve(repo_path, "git_commit", "write");
        if ("error" in r)
            return json(r);
        if (add_all) {
            const a = await runGit(["add", "-A"], r.path);
            if (!a.ok)
                return json({ success: false, error: `git add failed: ${a.err}` });
        }
        const c = await runGit(["commit", "-m", message.trim()], r.path);
        if (!c.ok)
            return json({ success: false, error: c.err || c.out });
        audit("git_commit", "ALLOW", `${r.path}: ${message.trim()}`);
        return json({ success: true, repository: r.path, output: c.out });
    });
    // ---- 4. Code symbols ---------------------------------------------------------------------
    mcp.registerTool("list_code_symbols", {
        description: "Extract classes, functions, methods, and line numbers from a source code file without reading the entire file.",
        inputSchema: { path: z.string() },
        annotations: READ_ONLY,
    }, async ({ path: p }) => {
        if (!cfg.enableRead)
            return json({ success: false, error: "File read disabled by policy." });
        const r = resolve(p, "list_code_symbols");
        if ("error" in r)
            return json(r);
        if (!fs.existsSync(r.path) || !fs.statSync(r.path).isFile())
            return json({ success: false, error: `File not found: ${r.path}` });
        if (fs.statSync(r.path).size > cfg.maxReadBytes)
            return json({ success: false, error: "File too large." });
        const out = listSymbols(fs.readFileSync(r.path).toString("utf8"), path.extname(r.path));
        return json({ success: true, path: r.path, ...out, symbol_count: out.symbols.length });
    });
    // ---- 5. Web --------------------------------------------------------------------------------
    mcp.registerTool("search_web", {
        description: "Search the web for documentation, error messages, or technical topics and return top results.",
        inputSchema: { query: z.string(), max_results: z.number().int().default(8) },
        annotations: READ_ONLY,
    }, async ({ query, max_results }) => {
        const q = query.trim();
        if (!q)
            return json({ success: false, error: "Search query cannot be empty." });
        const n = Math.max(1, Math.min(max_results, 15));
        try {
            const res = await safeFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
                maxBytes: 1024 * 1024,
                headers: { "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" },
            });
            const html = res.body.toString("utf8");
            const strip = (s) => htmlToMarkdown(s).markdown;
            const anchors = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
            const results = [];
            for (let i = 0; i < anchors.length && results.length < n; i++) {
                const a = anchors[i];
                const segment = html.slice(a.index, anchors[i + 1]?.index ?? html.length);
                const snip = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(segment)?.[1] ?? "";
                let url = a[1];
                if (url.includes("uddg=")) {
                    try {
                        url = decodeURIComponent(url.split("uddg=").pop().split("&")[0]);
                    }
                    catch {
                        /* keep raw */
                    }
                }
                const title = strip(a[2]);
                if (title && url.startsWith("http"))
                    results.push({ title, url, snippet: strip(snip) });
            }
            audit("search_web", "ALLOW", `query='${q}' results=${results.length}`);
            return json({ success: true, query: q, count: results.length, results });
        }
        catch (e) {
            return json({ success: false, error: `Web search failed: ${e.message}` });
        }
    });
    mcp.registerTool("fetch_web_page", {
        description: "Fetch a public web page or API endpoint and convert its content into clean Markdown text.",
        inputSchema: { url: z.string(), max_chars: z.number().int().default(15000) },
        annotations: READ_ONLY,
    }, async ({ url, max_chars }) => {
        try {
            const res = await safeFetch(url);
            const text = decodeBody(res.body, res.contentType);
            const isHtml = /html/i.test(res.contentType) || text.slice(0, 500).toLowerCase().includes("<html");
            const conv = isHtml ? htmlToMarkdown(text) : { title: "", markdown: text };
            const truncated = conv.markdown.length > max_chars;
            const content = truncated ? `${conv.markdown.slice(0, max_chars)}\n\n... [Truncated at ${max_chars} chars]` : conv.markdown;
            audit("fetch_web_page", "ALLOW", `${url} (${content.length} chars)`);
            return json({ success: true, url, title: conv.title, content_type: res.contentType, content, truncated });
        }
        catch (e) {
            return json({ success: false, error: `Failed to fetch URL: ${e.message}` });
        }
    });
    // ---- 6. Documents -----------------------------------------------------------------------
    mcp.registerTool("read_document", {
        description: "Read structured text from Office documents (.docx, .xlsx, .pptx) or PDF files.",
        inputSchema: { path: z.string(), max_chars: z.number().int().default(20000) },
        annotations: READ_ONLY,
    }, async ({ path: p, max_chars }) => {
        if (!cfg.enableRead)
            return json({ success: false, error: "File read disabled by policy." });
        const r = resolve(p, "read_document");
        if ("error" in r)
            return json(r);
        if (!fs.existsSync(r.path) || !fs.statSync(r.path).isFile())
            return json({ success: false, error: `File not found: ${r.path}` });
        if (fs.statSync(r.path).size > MAX_DOC_BYTES)
            return json({ success: false, error: "Document too large (limit 50 MB)." });
        const ext = path.extname(r.path).toLowerCase();
        try {
            let content = await readDocumentText(r.path, ext, max_chars);
            const truncated = content.length > max_chars;
            if (truncated)
                content = `${content.slice(0, max_chars)}\n\n... [Truncated at ${max_chars} chars]`;
            audit("read_document", "ALLOW", `${r.path} (${content.length} chars)`);
            return json({ success: true, path: r.path, format: ext.replace(/^\./, ""), content, truncated });
        }
        catch (e) {
            return json({ success: false, error: `Failed to parse document ${path.basename(r.path)}: ${e.message}` });
        }
    });
    // ---- 7. Scheduled tasks ---------------------------------------------------------------
    mcp.registerTool("schedule_task", {
        description: "Register an automated recurring task in the OS scheduler (Windows Task Scheduler / crontab), isolated under the `Jarvis_*` prefix. " +
            "The command must pass the same allowlist policy as run_terminal.",
        inputSchema: {
            task_name: z.string().describe("Identifier for the scheduled task (automatically prefixed with `Jarvis_`)."),
            command: z.string().describe("PowerShell command to execute (must pass allowlist policy)."),
            schedule_type: z.string().default("DAILY").describe("One of 'DAILY', 'HOURLY', 'MINUTE', or 'ONCE'."),
            start_time: z.string().default("09:00").describe("24-hour time string in 'HH:MM' format (e.g. '09:00')."),
            interval: z.number().int().default(1).describe("Modifier interval (every N days/hours/minutes, default 1)."),
            workdir: z.string().default("").describe("Optional working directory inside allowed sandbox."),
        },
        annotations: MUT,
    }, async ({ task_name, command, schedule_type, start_time, interval, workdir }) => {
        if (!cfg.enableTerminal)
            return json({ success: false, error: "Terminal / Task scheduling is disabled by policy." });
        let name;
        try {
            name = normalizeTaskName(task_name);
        }
        catch (e) {
            return json({ success: false, error: e.message });
        }
        const r = resolve(workdir, "schedule_task");
        if ("error" in r)
            return json(r);
        const sched = schedule_type.trim().toUpperCase();
        if (!["DAILY", "HOURLY", "MINUTE", "ONCE"].includes(sched))
            return json({ success: false, error: "schedule_type must be DAILY, HOURLY, MINUTE, or ONCE." });
        const time = start_time.trim();
        const tm = /^(\d{2}):(\d{2})$/.exec(time);
        if (!tm || Number(tm[1]) > 23 || Number(tm[2]) > 59)
            return json({ success: false, error: "start_time must be in HH:MM format (e.g. '09:00')." });
        const denied = await gateCommand(ctx, "schedule_task", command, r.path);
        if (denied)
            return json({ success: false, error: `Command rejected by allowlist policy: ${denied}` });
        const res = createTask(ctx, { name, cwd: r.path, command, schedule: sched, startTime: time, interval });
        if (!res.ok)
            return json({ success: false, error: res.error });
        audit("schedule_task", "ALLOW", `${name} (${sched} @ ${time}): ${command}`);
        return json({ success: true, task_name: name, schedule_type: sched, start_time: time, workdir: r.path, command, message: res.message });
    });
    mcp.registerTool("list_scheduled_tasks", { description: "List all automated tasks managed by Jarvis (`Jarvis_*`) in the OS scheduler.", annotations: READ_ONLY }, async () => {
        const t = await listTasks();
        return json(t.ok ? { success: true, count: t.tasks.length, tasks: t.tasks } : { success: false, error: `Failed to query scheduled tasks: ${t.error}` });
    });
    mcp.registerTool("delete_scheduled_task", {
        description: "Delete a Jarvis-managed scheduled task (`Jarvis_*`) from the OS scheduler.",
        inputSchema: { task_name: z.string() },
        annotations: MUT,
    }, async ({ task_name }) => {
        if (!cfg.enableTerminal)
            return json({ success: false, error: "Task deletion disabled by policy." });
        let name;
        try {
            name = normalizeTaskName(task_name);
        }
        catch (e) {
            return json({ success: false, error: e.message });
        }
        const d = deleteTask(ctx, name);
        if (!d.ok)
            return json({ success: false, error: d.error });
        audit("delete_scheduled_task", "ALLOW", `Deleted ${name}`);
        return json({ success: true, deleted_task: name, message: d.message });
    });
}
