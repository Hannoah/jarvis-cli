// Admin commands shared by the interactive prompt (/dirs, /permissions, ...) and the one-shot CLI (jarvis dirs ...):
// approved folders, access switches, terminal allowlist, MCP connection info and server lifecycle.
// Settings go through the same applySettings() the dashboard uses (validation included). A running MCP server reads
// them at startup, so it needs `jarvis restart` to pick them up; the calling process is updated immediately.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { c } from "./cliutil.js";
import { expandPath, loadConfig, readEnvFile, realResolve } from "./core/config.js";
import { createCtx } from "./core/context.js";
import { DEFAULT_ALLOWED_COMMANDS } from "./security/policy.js";
import { applySettings, readApiKey, regenerateApiKey } from "./supervisor/settings.js";
import { setClipboard } from "./system/platform.js";
import { portOpen, sleep } from "./system/proc.js";
import { gateCommand } from "./tools/terminal.js";
export const row = (k, v) => console.log(`  ${c.dim(k.padEnd(14))}${v}`);
const fail = (msg) => (console.error(c.red(`✖ ${msg}`)), 1);
const unquote = (s) => s.replace(/^(["'])(.*)\1$/, "$2");
const split = (args) => ({ pos: args.filter((a) => !a.startsWith("--")), flags: new Set(args.filter((a) => a.startsWith("--"))) });
const on = (b) => (b ? c.green("on") : c.red("off"));
// ---------- control plane: the running supervisor's dashboard API ----------
const dashPort = (cfg) => Number(readEnvFile(cfg.envFile).JARVIS_DASHBOARD_PORT) || 8766;
const tokenOf = (cfg) => {
    try {
        return fs.readFileSync(path.join(cfg.dataDir, ".dashboard_token"), "utf8").trim();
    }
    catch {
        return "";
    }
};
/**
 * null = nothing answers (no supervisor, or no token yet). HTTP errors throw with the server's message.
 * node:http with agent:false closes the socket after each call: a lingering keep-alive connection made process.exit()
 * crash on Windows ("Assertion failed ... async.c") and would otherwise keep the CLI alive for seconds.
 */
function control(cfg, method, p) {
    const token = tokenOf(cfg);
    if (!token)
        return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: dashPort(cfg), path: p, method, agent: false, timeout: 60_000, headers: { "x-jarvis-token": token, "content-type": "application/json", connection: "close" } }, (res) => {
            let raw = "";
            res.setEncoding("utf8");
            res.on("data", (d) => (raw += d));
            res.on("end", () => {
                let body = {};
                try {
                    body = JSON.parse(raw);
                }
                catch { /* non-JSON error page */ }
                if ((res.statusCode ?? 500) >= 400)
                    reject(Object.assign(new Error(body.error ?? `HTTP ${res.statusCode}`), { status: res.statusCode }));
                else
                    resolve(body);
            });
        });
        req.on("timeout", () => req.destroy());
        req.on("error", () => resolve(null)); // refused / reset / timed out: nobody home
        req.end(method === "POST" ? "{}" : undefined);
    });
}
const dur = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
};
export async function status(cfg) {
    const st = await control(cfg, "GET", "/api/state");
    if (!st) {
        row("supervisor", c.dim("not running"));
        row("MCP server", (await portOpen(cfg.port)) ? c.yellow(`port ${cfg.port} is open but no supervisor answers (started elsewhere?)`) : c.dim("stopped"));
        console.log(c.dim("  start it: jarvis start -d   (background)   or   jarvis start   (foreground)"));
        return 0;
    }
    const s = st.server;
    row("supervisor", `${c.green("running")}  dashboard :${dashPort(cfg)}`);
    row("MCP server", `${s.state === "running" ? c.green(s.state) : c.yellow(s.state)}${s.pid ? c.dim(`  pid ${s.pid}`) : ""}${s.state === "running" && s.started_at ? c.dim(`  up ${dur(Date.now() - s.started_at)}`) : ""}`);
    row("tunnel", `${st.tunnel.state === "running" ? c.green(st.tunnel.state) : c.dim(st.tunnel.state)}${st.tunnel.url ? `  ${st.tunnel.url}` : ""}`);
    return 0;
}
/** Start the supervisor (server + tunnel + dashboard) detached, so the terminal stays free. */
export async function startBackground(cfg, entry, flags) {
    if (await control(cfg, "GET", "/api/state"))
        return console.log(c.dim("Already running.")), await status(cfg);
    const child = spawn(process.execPath, [...process.execArgv, entry, "start", "--no-open", ...flags], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, JARVIS_HOME: cfg.dataDir },
    });
    child.unref();
    for (let i = 0; i < 60; i++) {
        await sleep(500);
        if (await control(cfg, "GET", "/api/state")) {
            console.log(c.green("✔ started in the background"));
            await sleep(1500); // let the MCP server finish booting before reporting its state
            await status(cfg);
            console.log(c.dim("  stop: jarvis stop   ·   connection info: jarvis mcp"));
            return 0;
        }
        if (child.exitCode !== null)
            break;
    }
    return fail(`The server did not come up. See ${path.join(cfg.dataDir, "supervisor.log")}`);
}
/** Stop everything the supervisor runs (MCP server, tunnel, dashboard). */
export async function stop(cfg) {
    let st;
    try {
        st = await control(cfg, "GET", "/api/state");
    }
    catch (e) {
        return fail(e.message);
    }
    if (!st) {
        console.log(c.dim((await portOpen(cfg.port)) ? `No supervisor answers, but port ${cfg.port} is open (started elsewhere?).` : "Not running."));
        return 0;
    }
    try {
        await control(cfg, "POST", "/api/shutdown");
    }
    catch (e) {
        if (e.status !== 404)
            return fail(e.message);
        // an older supervisor (e.g. jarvis-ts) has no shutdown endpoint: stop its MCP server, its window has to be closed by hand
        await control(cfg, "POST", "/api/server/stop");
        console.log(c.yellow("✔ MCP server stopped. That supervisor has no shutdown endpoint: close its window (or Ctrl+C) to end it."));
        return 0;
    }
    for (let i = 0; i < 40; i++) {
        if (!(await portOpen(dashPort(cfg))) && !(await portOpen(cfg.port)))
            return console.log(c.green("✔ stopped")), 0;
        await sleep(250);
    }
    return fail("Asked it to stop, but a port is still open. Check: jarvis status");
}
export async function restart(cfg) {
    if (!(await control(cfg, "GET", "/api/state")))
        return fail("Not running. Start it with: jarvis start -d");
    await control(cfg, "POST", "/api/server/restart");
    for (let i = 0; i < 20; i++) {
        const st = await control(cfg, "GET", "/api/state");
        if (st?.server.state === "running")
            return console.log(c.green("✔ MCP server restarted")), 0;
        await sleep(500);
    }
    return fail("Restarted, but the MCP server is not running yet. Check: jarvis status");
}
// ---------- settings ----------
/** Save a settings patch and refresh this process's live config (in place: tools hold the same object). */
function persist(cfg, patch) {
    applySettings(cfg.dataDir, patch);
    const f = loadConfig({ projectDir: cfg.projectDir, dataDir: cfg.dataDir });
    cfg.allowedDirs.splice(0, cfg.allowedDirs.length, ...f.allowedDirs);
    Object.assign(cfg, { enableRead: f.enableRead, enableWrite: f.enableWrite, enableTerminal: f.enableTerminal, terminalMode: f.terminalMode, extraAllowedCommands: f.extraAllowedCommands });
}
async function savedHint(cfg) {
    if (await portOpen(cfg.port))
        console.log(c.dim("  saved. The running MCP server picks it up after: jarvis restart"));
    else
        console.log(c.dim("  saved."));
}
const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
export async function dirs(cfg, args) {
    const { pos } = split(args);
    const [sub = "list", ...rest] = pos;
    const resolve = (p) => realResolve(path.resolve(cfg.defaultWorkdir, expandPath(unquote(p), cfg.home, process.env)));
    if (sub === "list") {
        for (const d of cfg.allowedDirs)
            console.log(`  ${fs.existsSync(d) ? c.green("✔") : c.red("✖")} ${d}${fs.existsSync(d) ? "" : c.dim("  (missing)")}`);
        console.log(c.dim("\n  jarvis dirs add <folder>   ·   jarvis dirs remove <folder>"));
        return 0;
    }
    if (!rest.length)
        return fail(`Usage: jarvis dirs ${sub === "add" || sub === "remove" ? sub : "add|remove"} <folder>`);
    if (sub === "add") {
        persist(cfg, { allowed_dirs: [...cfg.allowedDirs, ...rest.map(resolve)] }); // the effective list is saved, so defaults become explicit
        console.log(c.green(`✔ approved: ${rest.map(resolve).join(", ")}`));
    }
    else if (sub === "remove") {
        const targets = rest.map(resolve);
        const next = cfg.allowedDirs.filter((d) => !targets.some((t) => samePath(d, t)));
        if (next.length === cfg.allowedDirs.length)
            return fail("None of those folders is in the approved list. See: jarvis dirs");
        if (!next.length)
            return fail("At least one folder must stay approved (an empty list would fall back to your whole home folder).");
        persist(cfg, { allowed_dirs: next });
        console.log(c.green(`✔ removed: ${targets.join(", ")}`));
    }
    else
        return fail("Usage: jarvis dirs [list|add <folder>|remove <folder>]");
    await savedHint(cfg);
    return 0;
}
const SWITCHES = {
    read: ["enable_read", "enableRead"],
    write: ["enable_write", "enableWrite"],
    terminal: ["enable_terminal", "enableTerminal"],
};
export async function permissions(cfg, args) {
    const { pos, flags } = split(args);
    const [key, val] = pos;
    if (!key) {
        row("read files", on(cfg.enableRead));
        row("write files", on(cfg.enableWrite));
        row("terminal", on(cfg.enableTerminal));
        row("terminal mode", cfg.terminalMode === "allowlist" ? `${c.green("allowlist")} ${c.dim(`(${DEFAULT_ALLOWED_COMMANDS.size + cfg.extraAllowedCommands.size} commands, see: jarvis allowlist)`)}` : c.yellow("blocklist (anything not on a short deny list runs)"));
        row("folders", `${cfg.allowedDirs.length} approved ${c.dim("(jarvis dirs)")}`);
        console.log(c.dim("\n  jarvis permissions read|write|terminal on|off   ·   jarvis permissions mode allowlist|blocklist"));
        return 0;
    }
    if (key === "mode") {
        if (val !== "allowlist" && val !== "blocklist")
            return fail("Usage: jarvis permissions mode allowlist|blocklist");
        if (val === "blocklist" && !flags.has("--yes"))
            return fail("Blocklist mode lets the terminal run any command that is not on a short deny list. Repeat with --yes to confirm.");
        persist(cfg, { terminal_mode: val });
        console.log(c.green(`✔ terminal mode: ${val}`));
    }
    else if (SWITCHES[key]) {
        const want = ["on", "true", "1", "yes"].includes(val ?? "") ? true : ["off", "false", "0", "no"].includes(val ?? "") ? false : null;
        if (want === null)
            return fail(`Usage: jarvis permissions ${key} on|off`);
        persist(cfg, { [SWITCHES[key][0]]: want });
        console.log(c.green(`✔ ${key}: ${want ? "on" : "off"}`));
    }
    else
        return fail("Usage: jarvis permissions [read|write|terminal on|off] [mode allowlist|blocklist]");
    await savedHint(cfg);
    return 0;
}
// Commands that run arbitrary code or launch other programs: allowing them defeats the allowlist, so adding needs --yes.
export const BROAD = new Set(["powershell", "pwsh", "cmd", "wscript", "cscript", "mshta", "rundll32", "regsvr32", "invoke-expression", "iex", "start-process"]);
export async function allowlist(cfg, args) {
    const { pos, flags } = split(args);
    const [sub = "list", ...rest] = pos;
    const names = rest.flatMap((t) => t.split(/[,;\s]+/)).map((n) => n.trim().toLowerCase()).filter(Boolean);
    const extras = [...cfg.extraAllowedCommands].sort();
    if (sub === "list") {
        row("built-in", `${DEFAULT_ALLOWED_COMMANDS.size} commands ${c.dim("(jarvis allowlist list --all)")}`);
        row("added", extras.length ? extras.join(", ") : c.dim("none"));
        if (cfg.terminalMode !== "allowlist")
            console.log(c.yellow("  terminal mode is blocklist: the allowlist is not used right now"));
        if (flags.has("--all"))
            console.log("\n" + c.dim("  " + [...DEFAULT_ALLOWED_COMMANDS].sort().join(", ")));
        console.log(c.dim("\n  jarvis allowlist add <cmd...>   ·   remove <cmd...>   ·   check \"<command line>\""));
        return 0;
    }
    if (sub === "check") {
        const text = rest.join(" ").trim();
        if (!text)
            return fail('Usage: jarvis allowlist check "<command line>"');
        const ctx = createCtx(cfg, (() => undefined)); // a dry run must not write to the audit log
        const why = await gateCommand(ctx, "allowlist_check", text, cfg.defaultWorkdir);
        console.log(why ? `${c.red("✖ blocked")}  ${why}` : `${c.green("✔ allowed")}${cfg.enableTerminal ? "" : c.yellow("  (but the terminal is switched off)")}`);
        return why ? 1 : 0;
    }
    if (!names.length)
        return fail(`Usage: jarvis allowlist ${sub === "add" || sub === "remove" ? sub : "add|remove|check"} <command...>`);
    if (sub === "add") {
        const fresh = names.filter((n) => !DEFAULT_ALLOWED_COMMANDS.has(n) && !cfg.extraAllowedCommands.has(n));
        for (const n of names)
            if (!fresh.includes(n))
                console.log(c.dim(`  ${n}: already allowed`));
        const broad = fresh.filter((n) => BROAD.has(n));
        if (broad.length && !flags.has("--yes"))
            return fail(`${broad.join(", ")} can run or launch anything, which defeats the allowlist. Repeat with --yes if you really want that.`);
        if (!fresh.length)
            return 0;
        persist(cfg, { extra_allowed_commands: [...extras, ...fresh].join(";") });
        console.log(c.green(`✔ allowed: ${fresh.join(", ")}`) + c.dim("  (runs with your full user rights)"));
    }
    else if (sub === "remove") {
        const gone = names.filter((n) => cfg.extraAllowedCommands.has(n));
        for (const n of names)
            if (!gone.includes(n))
                console.log(c.dim(`  ${n}: ${DEFAULT_ALLOWED_COMMANDS.has(n) ? "built-in, cannot be removed" : "not in your added list"}`));
        if (!gone.length)
            return 1;
        persist(cfg, { extra_allowed_commands: extras.filter((e) => !gone.includes(e)).join(";") });
        console.log(c.green(`✔ removed: ${gone.join(", ")}`));
    }
    else
        return fail("Usage: jarvis allowlist [list|add <cmd...>|remove <cmd...>|check \"<command line>\"]");
    await savedHint(cfg);
    return 0;
}
// ---------- MCP connection info ----------
const maskKey = (k) => (k ? `${k.slice(0, 6)}…(${k.length} chars)` : c.red("(none yet: run jarvis start once)"));
function snippet(kind, url, key) {
    const curl = process.platform === "win32" ? "curl.exe" : "curl"; // PowerShell's `curl` is Invoke-WebRequest
    switch (kind) {
        case "claude": return `claude mcp add --transport http jarvis ${url} --header "X-API-Key: ${key}"`;
        case "cursor": return JSON.stringify({ mcpServers: { jarvis: { url, headers: { "X-API-Key": key } } } }, null, 2);
        case "curl": return `${curl} -X POST ${url} -H "X-API-Key: ${key}" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;
        default: return null;
    }
}
export async function mcp(cfg, args) {
    const { pos, flags } = split(args);
    const [sub = "info", arg] = pos;
    const st = await control(cfg, "GET", "/api/state").catch(() => null);
    const local = `http://127.0.0.1:${cfg.port}/mcp`;
    const pub = st?.urls.public || cfg.publicUrl || "";
    const best = pub || local;
    const key = readApiKey(cfg);
    if (sub === "info") {
        row("MCP server", st ? (st.server.state === "running" ? c.green("running") : c.yellow(st.server.state)) : (await portOpen(cfg.port)) ? c.green("running") : c.dim("stopped"));
        row("HTTPS URL", pub || c.dim("none (no tunnel yet; start with the tunnel enabled)"));
        row("local URL", local);
        row("API key", `${maskKey(key)}  ${c.dim("jarvis mcp key | jarvis mcp copy key")}`);
        row("auth", `header ${c.cyan("X-API-Key: <key>")} ${c.dim("or")} ${c.cyan("Authorization: Bearer <key>")}`);
        const base = best.replace(/\/mcp\/?$/, "");
        console.log(`\n  ${c.bold("OAuth 2.0 (manual), e.g. Copilot Studio")}`);
        row("client id", "pc-mcp-client");
        row("secret", c.dim("your API key"));
        row("authorize", `${base}/oauth/authorize`);
        row("token", `${base}/oauth/token`);
        row("dashboard", `http://127.0.0.1:${dashPort(cfg)}  ${c.dim("(jarvis url prints the sign-in link)")}`);
        console.log(c.dim("\n  jarvis mcp config claude|cursor|curl   ·   jarvis mcp copy url|key|claude|cursor   ·   jarvis mcp rotate --yes"));
        return 0;
    }
    if (sub === "key") {
        if (!key)
            return fail("No API key yet. Run: jarvis start");
        console.log(key);
        return 0;
    }
    if (sub === "config") {
        const kind = arg ?? "claude";
        const text = snippet(kind, best, flags.has("--show-key") ? key : "<API_KEY>");
        if (!text)
            return fail("Usage: jarvis mcp config claude|cursor|curl [--show-key]");
        console.log(text);
        if (!flags.has("--show-key"))
            console.log(c.dim("\n  <API_KEY> is a placeholder: --show-key prints it, or: jarvis mcp copy " + kind));
        return 0;
    }
    if (sub === "copy") {
        const what = arg ?? "url";
        const text = what === "url" ? best : what === "key" ? key : snippet(what, best, key);
        if (!text)
            return fail("Usage: jarvis mcp copy url|key|claude|cursor|curl");
        setClipboard(text);
        console.log(c.green(`✔ copied ${what === "url" ? best : what === "key" ? "the API key" : `the ${what} config (with the key)`} to the clipboard`));
        return 0;
    }
    if (sub === "rotate") {
        if (!flags.has("--yes"))
            return fail("This invalidates the current key: every connected client must be updated. Repeat with --yes to confirm.");
        const fresh = regenerateApiKey(cfg);
        console.log(c.green(`✔ new API key: ${maskKey(fresh)}`) + c.dim("  (jarvis mcp copy key). Update your clients."));
        return 0;
    }
    return fail("Usage: jarvis mcp [info|key|config <client>|copy <what>|rotate --yes]");
}
export async function adminCommand(name, args, cfg) {
    try {
        switch (name) {
            case "status": return await status(cfg);
            case "stop": return await stop(cfg);
            case "restart": return await restart(cfg);
            case "dirs": return await dirs(cfg, args);
            case "permissions": return await permissions(cfg, args);
            case "allowlist": return await allowlist(cfg, args);
            case "mcp": return await mcp(cfg, args);
        }
    }
    catch (e) {
        return fail(e.message);
    }
    return fail(`Unknown admin command ${name}`);
}
