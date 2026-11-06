#!/usr/bin/env node
// Jarvis CLI: runs the Jarvis MCP tools in-process (no HTTP, tunnel, OAuth or dashboard), or starts the MCP server.
// Sandbox, command policy and audit log are the tools' own, so behaviour matches the server.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { adminCommand, BROAD, row, startBackground, status as liveStatus } from "./admin.js";
import { c, categorize, cmdline, coerce, currentTheme, errorOf, exitCodeOf, gradient, isTTY, parseArgs, propType, render, setTheme, shortPath, suggest, themeNames, themeSwatch, tokenize, toolHelp, truncate, usage, } from "./cliutil.js";
import { expandPath, isResolvedPathAllowed, loadConfig, readEnvFile, realResolve } from "./core/config.js";
import { createCtx } from "./core/context.js";
import { appDir, prepareDataDir } from "./core/paths.js";
import { VERSION } from "./core/version.js";
import { createMcpServer } from "./server/mcp.js";
import { loadPlugins } from "./server/plugins.js";
import { psExecutable } from "./security/policy.js";
import { SERVER_CMDS, serverCommand } from "./serverCmd.js";
import { launchNotice, offerUpdate, updateCommand } from "./update.js";
import { updateEnvFile } from "./supervisor/settings.js";
import { enrichEnv, which } from "./system/cliEnv.js";
import { openDefault } from "./system/platform.js";
import { portOpen } from "./system/proc.js";
import { ask, select, SIGINT, withSpinner } from "./tui.js";
const HELP = `${c.bold(`Jarvis CLI ${VERSION}`)}

${c.dim("Usage")}
  jarvis                          interactive mode: prompt, / command menu, guided tool forms
  jarvis ${c.cyan("<tool>")} [args]          run a tool:  jarvis read_file notes.txt
  jarvis ${c.cyan("list")} [filter]          list tools (filter by name or description)
  jarvis ${c.cyan("help")} <tool>            parameters and usage  (also: jarvis <tool> --help)
  jarvis ${c.cyan("shell")}                  same as plain \`jarvis\` (also reads commands from a pipe)
  jarvis ${c.cyan("completion")} <powershell|bash>   print a completion script
  jarvis ${c.cyan("update")}                 look for a newer release on GitHub and install it (the prompt also offers it once a day)

${c.dim("MCP server")}  (for Copilot Studio, Claude, Cursor, ...)
  jarvis ${c.cyan("start")} [--no-tunnel] [--no-open]   MCP server + Dev Tunnel + web dashboard, supervised (Ctrl+C stops)
  jarvis ${c.cyan("serve")}                  only the MCP server on 127.0.0.1 (no supervision, no tunnel)
  jarvis ${c.cyan("open")} | ${c.cyan("url")}              open / print the dashboard URL (with its one-time sign-in token)
  jarvis ${c.cyan("install")} | ${c.cyan("uninstall")}     start automatically at login (Task Scheduler / LaunchAgent / systemd)
  jarvis ${c.cyan("start")} -d | --background   same as start, but detached: the terminal stays free
  jarvis ${c.cyan("stop")} | ${c.cyan("restart")} | ${c.cyan("status")}   stop everything · restart the MCP server · show what is running
  jarvis ${c.cyan("tunnel")} [status|start|stop|restart]   Dev Tunnel control (after "giving up", restart it by hand)
  jarvis ${c.cyan("mcp")} [key|config <client>|copy <what>|rotate --yes]   connection info: URLs, API key, client configs

${c.dim("Access control")}  (saved to the settings file; run "jarvis restart" to apply to a running server)
  jarvis ${c.cyan("dirs")} [add|remove <folder>]       approved folders
  jarvis ${c.cyan("permissions")} [read|write|terminal on|off | mode allowlist|blocklist]
  jarvis ${c.cyan("allowlist")} [add|remove <cmd...> | check "<command line>"]

${c.dim("Arguments")}
  positional      fill required params first:   jarvis read_file notes.txt 1 20
  --name value    or --name=value; bare --flag = true; arrays/objects take JSON
  --json '{...}'  all arguments as JSON
  --raw           print the tool's exact text (default when piped)

${c.dim("Notes")}
  Settings: ~/.jarvis/.env (or JARVIS_HOME). Relative paths are relative to the current folder when it is allowed.
  Exit codes: 0 ok, 1 tool/runtime error, 2 missing arguments. NO_COLOR disables colors.
`;
const ENTRY = fileURLToPath(import.meta.url); // this file, for spawning the background supervisor
let interactive = false; // set by the prompt: adds a per-call status line after each tool result
const took = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
// "JARVIS" in the ANSI Shadow font, six rows; coloured with the theme gradient on the welcome screen
const LOGO = (() => {
    const glyphs = [
        ["     ██╗", "     ██║", "     ██║", "██   ██║", "╚█████╔╝", " ╚════╝ "],
        [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
        ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
        ["██╗   ██╗", "██║   ██║", "██║   ██║", "╚██╗ ██╔╝", " ╚████╔╝ ", "  ╚═══╝  "],
        ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
        ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
    ];
    return [0, 1, 2, 3, 4, 5].map((r) => glyphs.map((g) => g[r]).join("").trimEnd());
})();
function list(tools, rest) {
    const flags = new Set(rest.filter((a) => a.startsWith("--")));
    const q = rest.find((a) => !a.startsWith("--"))?.toLowerCase();
    const shown = tools.filter((t) => !q || t.name.includes(q.replace(/-/g, "_")) || (t.description ?? "").toLowerCase().includes(q));
    if (flags.has("--json"))
        return void console.log(JSON.stringify(shown.map((t) => ({ name: t.name, description: t.description }))));
    if (flags.has("--names"))
        return void console.log(shown.map((t) => t.name).join("\n"));
    const w = Math.max(0, ...shown.map((t) => t.name.length));
    const room = (process.stdout.columns ?? 120) - w - 5;
    const row = (t) => `${c.accent(t.name.padEnd(w))}  ${c.gray(truncate((t.description ?? "").split("\n")[0], room))}`;
    if (isTTY && !q) {
        for (const [cat, ts] of categorize(shown)) {
            console.log(`\n${c.bold(cat)} ${c.gray(`(${ts.length})`)}`);
            for (const t of ts)
                console.log(`  ${row(t)}`);
        }
    }
    else
        for (const t of shown)
            console.log(row(t));
    if (isTTY)
        console.log(c.gray(`\n${shown.length} tool${shown.length === 1 ? "" : "s"} · jarvis help <tool>`));
    if (!shown.length)
        console.error(c.yellow(`No tool matches '${q}'.`));
}
const completion = (shell, names) => shell === "bash"
    ? `complete -W "list help shell completion update ${SERVER_CMDS.join(" ")} ${names.join(" ")}" jarvis`
    : `Register-ArgumentCompleter -Native -CommandName jarvis -ScriptBlock {
  param($word, $ast, $pos)
  '${["list", "help", "shell", "completion", "update", ...SERVER_CMDS, ...names].join("','")}' -split ',' | Where-Object { $_ -like "$word*" } |
    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}`;
/** Call a tool and print its result. Returns the process exit code. In the prompt each call is drawn as a small card. */
async function execute(client, tool, args, raw) {
    const t0 = Date.now();
    const cols = (process.stdout.columns ?? 80) - 1;
    const bar = (color, text) => text.split("\n").map((l) => `${color("│ ")}${l}`).join("\n");
    if (interactive) {
        const flags = cmdline(tool.name, args).slice(tool.name.length).trim();
        console.log(`${c.accent("●")} ${c.bold(tool.name)}${flags ? c.gray(`  ${truncate(flags, Math.max(10, cols - tool.name.length - 4))}`) : ""}`);
    }
    const call = client.callTool({ name: tool.name, arguments: args });
    const res = await (raw ? call : withSpinner(tool.name, call));
    let code = res.isError ? 1 : 0;
    for (const part of (res.content ?? [])) {
        if (part.type !== "text") {
            console.log(interactive ? bar(c.gray, c.dim(`[${part.type} content omitted]`)) : c.dim(`[${part.type} content omitted]`));
            continue;
        }
        const err = errorOf(part.text ?? "");
        if (exitCodeOf(part.text ?? ""))
            code = 1;
        if (err && !raw) {
            code = 1;
            if (interactive)
                console.log(bar(c.red, `${c.red(`✖ ${err.message}`)}${err.extra ? `\n${err.extra}` : ""}`));
            else {
                console.error(c.red(`✖ ${err.message}`));
                if (err.extra)
                    console.error(err.extra);
            }
        }
        else {
            if (err)
                code = 1;
            const text = raw ? (part.text ?? "") : render(part.text ?? "");
            console.log(interactive ? bar(c.gray, text) : text);
        }
    }
    if (interactive)
        console.log(`${c.gray("╰")} ${code ? c.red("✖") : c.green("✔")} ${c.gray(took(Date.now() - t0))}`);
    return code;
}
async function run(client, tools, argv, raw) {
    const [cmd = "help", ...rest] = argv;
    if (cmd === "list")
        return list(tools, rest), 0;
    if (cmd === "completion") {
        if (!["powershell", "bash"].includes(rest[0] ?? ""))
            return console.error(c.red("✖ Usage: jarvis completion <powershell|bash>")), 2;
        return console.log(completion(rest[0], tools.map((t) => t.name))), 0;
    }
    const wanted = cmd === "help" ? rest[0] ?? "" : cmd;
    const tool = tools.find((t) => t.name === wanted.replace(/-/g, "_"));
    if (!tool) {
        const hint = suggest(wanted, tools.map((t) => t.name));
        console.error(c.red(`✖ Unknown tool '${wanted}'.`) + (hint.length ? ` Did you mean: ${hint.map((h) => c.cyan(h)).join(", ")}?` : " Try: jarvis list"));
        return 1;
    }
    const schema = tool.inputSchema;
    if (cmd === "help")
        return console.log(toolHelp(tool)), 0;
    const { args, help } = parseArgs(rest, schema);
    if (help)
        return console.log(toolHelp(tool)), 0;
    const missing = (schema.required ?? []).filter((k) => args[k] === undefined);
    if (missing.length) {
        console.error(c.red(`✖ Missing required: ${missing.map((k) => `--${k}`).join(", ")}`) + `\n${c.dim("Usage:")} ${usage(tool.name, schema)}`);
        return 2;
    }
    return execute(client, tool, args, raw);
}
// ---------- interactive mode ----------
const unquote = (s) => s.replace(/^(["'])(.*)\1$/, "$2");
async function shell(client, tools, ctx) {
    const tty = !!process.stdin.isTTY && isTTY;
    const home = os.homedir();
    const cols = () => (process.stdout.columns ?? 80) - 1;
    const hist = []; // newest first
    const setTitle = () => {
        if (tty)
            process.stdout.write(`\x1b]0;Jarvis · ${path.basename(ctx.cfg.defaultWorkdir) || ctx.cfg.defaultWorkdir}\x07`);
    };
    const needTTY = () => (tty ? false : (console.error(c.red("✖ This needs an interactive terminal.")), true));
    /** Guided form: required params first, then a menu of optional ones with a Run item on top. */
    async function form(tool) {
        const schema = tool.inputSchema;
        const props = schema.properties ?? {};
        const req = schema.required ?? [];
        const args = {};
        const cancelled = () => console.log(c.dim("cancelled"));
        const setParam = async (k) => {
            const p = props[k];
            const desc = (p.description ?? "").split("\n")[0];
            if (desc)
                console.log(c.dim(`  ${truncate(desc, cols() - 2)}`));
            if (p.enum) {
                const v = await select(k, p.enum.map((e) => ({ label: String(e), value: e })));
                if (v === undefined)
                    return false;
                args[k] = v;
                return true;
            }
            for (;;) {
                const a = await ask(`  ${c.cyan(k)}${req.includes(k) ? c.yellow("*") : ""} ${c.dim(`(${propType(p)})`)}: `);
                if (a === null || a === SIGINT)
                    return false;
                if (!a.trim()) {
                    if (req.includes(k))
                        continue; // required: ask again (Ctrl+C cancels)
                    delete args[k];
                    return true;
                }
                args[k] = coerce(unquote(a.trim()), p);
                return true;
            }
        };
        console.log(c.bold(tool.name) + c.dim(`  ${truncate((tool.description ?? "").split("\n")[0], cols() - tool.name.length - 2)}`));
        for (const k of req)
            if (!(await setParam(k)))
                return cancelled();
        const optional = Object.keys(props).filter((k) => !req.includes(k));
        while (optional.length) {
            const pick = await select(`${tool.name}: set options or run`, [
                { label: "▶ Run", hint: cmdline(tool.name, args), value: "" },
                ...optional.map((k) => ({
                    label: `+ ${k}`,
                    hint: args[k] !== undefined ? `= ${JSON.stringify(args[k])}` : (props[k]?.description ?? "").split("\n")[0],
                    value: k,
                })),
            ]);
            if (pick === undefined)
                return cancelled();
            if (pick === "")
                break;
            if (!(await setParam(pick)))
                return cancelled();
        }
        await execute(client, tool, args, false);
    }
    async function browse() {
        if (needTTY())
            return;
        const cats = [["All tools", tools], ...categorize(tools)];
        const group = await select("Tools", cats.map(([name, ts]) => ({ label: name, hint: `${ts.length} tools`, value: ts })));
        if (!group)
            return;
        const tool = await select("Pick a tool", group.map((t) => ({ label: t.name, hint: (t.description ?? "").split("\n")[0], value: t })));
        if (tool)
            await form(tool);
    }
    async function cd(arg) {
        let target = arg.trim();
        if (!target && tty) {
            console.log(c.dim(`  current: ${ctx.cfg.defaultWorkdir}`));
            const a = await ask("  new folder (Enter to keep): ");
            if (typeof a !== "string")
                return;
            target = a.trim();
        }
        if (!target)
            return void console.log(ctx.cfg.defaultWorkdir);
        const dir = realResolve(path.resolve(ctx.cfg.defaultWorkdir, expandPath(unquote(target), home, process.env)));
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
            return void console.error(c.red(`✖ Not a folder: ${dir}`));
        if (!isResolvedPathAllowed(ctx.cfg, dir))
            return void console.error(c.red(`✖ Outside the allowed folders: ${ctx.cfg.allowedDirs.join(", ")}`));
        ctx.cfg.defaultWorkdir = dir;
        setTitle();
        process.chdir(dir); // some tools resolve relative paths against the process cwd, others against the workdir: keep both the same
        console.log(c.dim(`working folder: ${dir}`));
    }
    const execTool = async (name, args = {}) => void (await execute(client, tools.find((t) => t.name === name), args, false));
    const maskSecret = (l) => l.replace(/^(\s*[\w.]*(?:KEY|TOKEN|SECRET|PASSWORD)[\w.]*\s*=).+$/i, "$1 ********");
    async function status() {
        const cfg = ctx.cfg;
        row("version", VERSION);
        row("folder", cfg.defaultWorkdir);
        row("settings", cfg.dataDir);
        row("allowed", cfg.allowedDirs.join("; "));
        row("access", `read ${cfg.enableRead ? "on" : "off"} · write ${cfg.enableWrite ? "on" : "off"} · terminal ${cfg.enableTerminal ? (cfg.allowUnsafe ? "unsafe" : cfg.terminalMode) : "off"}`);
        await liveStatus(cfg);
    }
    async function doctor() {
        const line = (good, label, detail = "") => console.log(`  ${good === null ? c.dim("–") : good ? c.green("✔") : c.red("✖")} ${label}${detail ? c.dim(`  ${detail}`) : ""}`);
        line(Number(process.versions.node.split(".")[0]) >= 22, `Node ${process.versions.node}`, "needs 22 or newer");
        const ps = which([psExecutable()], process.env);
        line(!!ps, `${psExecutable()}`, ps ?? "required by run_terminal");
        let writable = true;
        try {
            fs.accessSync(ctx.cfg.dataDir, fs.constants.W_OK);
        }
        catch {
            writable = false;
        }
        line(writable, "settings folder is writable", ctx.cfg.dataDir);
        const missing = ctx.cfg.allowedDirs.filter((d) => !fs.existsSync(d));
        line(!missing.length, "allowed folders exist", missing.join("; "));
        for (const [label, bins] of [["git", ["git"]], ["devtunnel (external access)", ["devtunnel"]], ["kubectl", ["kubectl"]], ["Azure CLI", ["az"]], ["Power Platform CLI", ["pac"]], ["SAS Viya CLI", ["sas-viya"]]]) {
            const found = which([...bins], process.env);
            line(found ? true : null, label, found ?? "not found (optional)");
        }
    }
    async function config(arg) {
        const f = ctx.cfg.envFile;
        if (arg.trim() === "edit") {
            if (!fs.existsSync(f))
                fs.writeFileSync(f, "# Jarvis settings (see the README for keys)\n", { mode: 0o600 });
            openDefault(f);
            return void console.log(c.dim(`opening ${f}`));
        }
        console.log(c.dim(f));
        console.log(fs.existsSync(f) ? fs.readFileSync(f, "utf8").split(/\r?\n/).map(maskSecret).join("\n").trimEnd() : c.dim("(no settings file yet: defaults in use)"));
        console.log(c.dim("\n  /config edit   open it in your editor (restart the server after changes)"));
    }
    const confirm = async (question) => (await select(question, [{ label: "No", value: false }, { label: "Yes", value: true }])) === true;
    // Menus for the admin commands. Each action calls the same adminCommand() as `jarvis dirs|permissions|allowlist|mcp ...`.
    async function dirsMenu() {
        for (;;) {
            const pick = await select("Approved folders (saved immediately)", [
                { label: "+ Add a folder…", value: "+" },
                ...ctx.cfg.allowedDirs.map((d) => ({ label: `- ${d}`, hint: "Enter removes it", value: d })),
                { label: "Done", value: "" },
            ]);
            if (!pick)
                return;
            if (pick === "+") {
                const a = await ask("  folder: ");
                if (typeof a === "string" && a.trim())
                    await adminCommand("dirs", ["add", a.trim()], ctx.cfg);
            }
            else if (await confirm(`Remove ${pick}?`))
                await adminCommand("dirs", ["remove", pick], ctx.cfg);
        }
    }
    async function allowMenu() {
        for (;;) {
            const pick = await select("Allowed terminal commands (saved immediately)", [
                { label: "+ Add a command…", value: "+" },
                { label: "? Check a command line…", value: "?" },
                ...[...ctx.cfg.extraAllowedCommands].sort().map((e) => ({ label: `- ${e}`, hint: "added by you · Enter removes it", value: e })),
                { label: "Done", hint: "built-in commands: jarvis allowlist list --all", value: "" },
            ]);
            if (!pick)
                return;
            if (pick === "+") {
                const a = await ask("  command name(s): ");
                if (typeof a !== "string" || !a.trim())
                    continue;
                const names = a.trim().split(/[\s,;]+/);
                const args = ["add", ...names];
                if (names.some((n) => BROAD.has(n.toLowerCase()))) {
                    if (!(await confirm("That command can run or launch anything, which defeats the allowlist. Allow it anyway?")))
                        continue;
                    args.push("--yes");
                }
                await adminCommand("allowlist", args, ctx.cfg);
            }
            else if (pick === "?") {
                const a = await ask("  command line: ");
                if (typeof a === "string" && a.trim())
                    await adminCommand("allowlist", ["check", a.trim()], ctx.cfg);
            }
            else if (await confirm(`Remove ${pick}?`))
                await adminCommand("allowlist", ["remove", pick], ctx.cfg);
        }
    }
    async function permissionsMenu() {
        for (;;) {
            const cfg = ctx.cfg;
            const sw = (b) => (b ? "on" : "off");
            const pick = await select("Permissions (Enter toggles, saved immediately)", [
                { label: `Read files      ${sw(cfg.enableRead)}`, value: "read" },
                { label: `Write files     ${sw(cfg.enableWrite)}`, value: "write" },
                { label: `Terminal        ${sw(cfg.enableTerminal)}`, value: "terminal" },
                { label: `Terminal mode   ${cfg.terminalMode}`, hint: "allowlist (safe) or blocklist (runs anything not denied)", value: "mode" },
                { label: "Approved folders…", hint: `${cfg.allowedDirs.length} folders`, value: "dirs" },
                { label: "Allowed commands…", hint: `${cfg.extraAllowedCommands.size} added by you`, value: "allow" },
                { label: "Done", value: "" },
            ]);
            if (!pick)
                return;
            if (pick === "dirs")
                await dirsMenu();
            else if (pick === "allow")
                await allowMenu();
            else if (pick === "mode") {
                const next = cfg.terminalMode === "allowlist" ? "blocklist" : "allowlist";
                if (next === "blocklist" && !(await confirm("Blocklist mode lets the terminal run any command that is not on a short deny list. Switch?")))
                    continue;
                await adminCommand("permissions", ["mode", next, "--yes"], cfg);
            }
            else {
                const cur = pick === "read" ? cfg.enableRead : pick === "write" ? cfg.enableWrite : cfg.enableTerminal;
                await adminCommand("permissions", [pick, cur ? "off" : "on"], cfg);
            }
        }
    }
    async function mcpMenu() {
        for (;;) {
            const pick = await select("MCP connection", [
                { label: "Copy URL", hint: "HTTPS if the tunnel is up, else local", value: ["copy", "url"] },
                { label: "Copy API key", value: ["copy", "key"] },
                { label: "Show API key", hint: "prints the secret on screen", value: ["key"] },
                { label: "Copy Claude Code command", hint: "includes the key", value: ["copy", "claude"] },
                { label: "Copy Cursor config", hint: "includes the key", value: ["copy", "cursor"] },
                { label: "Rotate API key…", hint: "every connected client must be updated", value: ["rotate"] },
                { label: "Done", value: [] },
            ]);
            if (!pick?.length)
                return;
            if (pick[0] === "rotate") {
                if (!(await confirm("Rotate the API key? The current one stops working.")))
                    continue;
                pick.push("--yes");
            }
            await adminCommand("mcp", pick, ctx.cfg);
        }
    }
    /** `/name args` runs the command; bare `/name` in a terminal shows the current state and opens its menu. */
    const adminSlash = (name, menu) => async (a) => {
        const args = tokenize(a);
        if (args.length || !tty)
            return void (await adminCommand(name, args, ctx.cfg));
        await adminCommand(name, [], ctx.cfg);
        await menu();
    };
    async function themeCmd(arg) {
        let name = arg.trim().toLowerCase();
        if (!name) {
            if (needTTY())
                return;
            const pick = await select("Theme (saved)", themeNames.map((n) => ({ label: n, hint: n === currentTheme() ? "current" : "", value: n })));
            if (!pick)
                return;
            name = pick;
        }
        if (!setTheme(name))
            return void console.error(c.red(`✖ Unknown theme '${name}'. Choose: ${themeNames.join(", ")}`));
        updateEnvFile(ctx.cfg.envFile, { JARVIS_THEME: name });
        console.log(`${c.green("✔")} theme: ${name} ${themeSwatch(name)}`);
    }
    // Names follow Claude Code where there is an equivalent (/help /clear /status /doctor /permissions /add-dir /config /memory /mcp /exit).
    const slash = {
        "/help": {
            hint: "How to use this prompt",
            run: async () => console.log([
                "  <tool> [args]    run a tool, e.g.  read_file notes.txt   (help <tool> for parameters)",
                "  !<command>       run a shell command through run_terminal, e.g.  !git status",
                "  /                command menu (↑↓ + Enter, type to filter)",
                "  /tools           pick a tool and fill in its parameters step by step",
                "  /mcp /dirs /permissions /allowlist   connection info · approved folders · access switches · command allowlist",
                "  /start /stop /restart                run / stop / restart the MCP server in the background",
                "  clear            clear the screen (also /clear, Ctrl+L)",
                "  /theme           change the accent colour (saved)",
                "  Tab              completes tool names, --options and /commands",
                "  ↑ / ↓            previous commands · Ctrl+C twice, Ctrl+D or /exit to quit",
                "",
                "  From your shell (not this prompt):",
                "    jarvis start | serve | open | url | install | uninstall    MCP server, tunnel, dashboard",
                "    jarvis list | help <tool> | completion <powershell|bash> | update",
            ].map((l) => c.dim(l)).join("\n")),
        },
        "/clear": { hint: "Clear the screen", run: async () => void console.clear() },
        "/status": { hint: "Version, folder, access policy and MCP server state", run: status },
        "/doctor": { hint: "Check Node, PowerShell, git, devtunnel and other prerequisites", run: doctor },
        "/config": { hint: "Show the settings file (secrets masked); /config edit opens it", run: config },
        "/theme": { hint: "Change the accent colour theme (saved): blue, violet, emerald, amber, rose, mono", run: themeCmd },
        "/memory": { hint: "Wiki memory index (wiki_index)", run: async () => execTool("wiki_index") },
        "/dirs": { hint: "Approved folders: list, add, remove (saved)", run: adminSlash("dirs", dirsMenu) },
        "/add-dir": { hint: "Approve a folder (saved): /add-dir <folder>", run: async (a) => void (await adminCommand("dirs", ["add", ...tokenize(a)], ctx.cfg)) },
        "/permissions": { hint: "Read/write/terminal switches and terminal mode (menu)", run: adminSlash("permissions", permissionsMenu) },
        "/allowlist": { hint: "Terminal command allowlist: list, add, remove, check", run: adminSlash("allowlist", allowMenu) },
        "/mcp": { hint: "MCP connection info: URLs, API key, client configs", run: adminSlash("mcp", mcpMenu) },
        "/start": { hint: "Start the MCP server, tunnel and dashboard in the background", run: async () => void (await startBackground(ctx.cfg, ENTRY, [])) },
        "/stop": { hint: "Stop the MCP server, tunnel and dashboard", run: async () => void (await adminCommand("stop", [], ctx.cfg)) },
        "/tunnel": { hint: "Dev Tunnel: status, start, stop, restart", run: async (a) => void (await adminCommand("tunnel", tokenize(a), ctx.cfg)) },
        "/restart": { hint: "Restart the MCP server (applies saved settings)", run: async () => void (await adminCommand("restart", [], ctx.cfg)) },
        "/tools": { hint: "Browse tools by category and run one with a guided form", run: browse },
        "/list": { hint: "List tools, optionally filtered: /list git", run: async (a) => list(tools, a ? [a] : []) },
        "/cd": { hint: "Show or change the working folder (must be inside an allowed folder)", run: cd },
        "/version": { hint: "Show the version", run: async () => void console.log(VERSION) },
        "/exit": { hint: "Quit (also /quit, Ctrl+D)", run: async () => "exit" },
    };
    const ALIASES = { "/quit": "/exit", "/env": "/status", "/cls": "/clear", "/?": "/help", "/menu": "/" };
    const completer = (line) => {
        const toks = line.split(/\s+/);
        const last = toks.at(-1) ?? "";
        if (toks.length <= 1)
            return [[...Object.keys(slash), "clear", "list", "help", "exit", ...tools.map((t) => t.name)].filter((n) => n.startsWith(last)), last];
        const props = Object.keys(tools.find((t) => t.name === toks[0])?.inputSchema?.properties ?? {});
        return [props.map((p) => `--${p}`).filter((f) => f.startsWith(last)), last];
    };
    /** true = quit */
    async function handle(line) {
        const t = line.trim();
        if (!t)
            return false;
        const word = t.toLowerCase();
        if (word === "exit" || word === "quit")
            return true;
        if (word === "clear" || word === "cls")
            return console.clear(), false;
        if (word === "help" || word === "?")
            return await slash["/help"].run(""), false;
        if (t.startsWith("!")) {
            // like Claude Code's bash mode: same sandbox and command policy as run_terminal
            const command = t.slice(1).trim();
            if (!command)
                return console.error(c.dim("usage: !<command>   e.g.  !git status")), false;
            return await execTool("run_terminal", { command }), false;
        }
        if (!t.startsWith("/"))
            return await run(client, tools, tokenize(t), false), false;
        const [raw = "", ...rest] = t.split(/\s+/);
        const name = ALIASES[raw] ?? raw;
        if (name === "/") {
            if (needTTY())
                return false;
            const pick = await select("Commands", Object.entries(slash).map(([k, v]) => ({ label: k, hint: v.hint, value: k })));
            return pick ? (await slash[pick].run("")) === "exit" : false;
        }
        const cmd = slash[name];
        if (!cmd) {
            const hint = suggest(raw.slice(1), Object.keys(slash).map((k) => k.slice(1))).map((h) => c.cyan(`/${h}`));
            console.error(c.red(`✖ Unknown command ${raw}.`) + (hint.length ? ` Did you mean: ${hint.join(", ")}?` : " Type / for the menu."));
            return false;
        }
        return (await cmd.run(rest.join(" "))) === "exit";
    }
    const guarded = (line) => handle(line).catch((e) => (console.error(c.red(`✖ ${e.message}`)), false));
    // Piped input: run each line, no menus (readline would drop buffered lines if reopened per prompt).
    if (!tty) {
        for (const line of fs.readFileSync(0, "utf8").split(/\r?\n/))
            if (await guarded(line))
                break;
        return;
    }
    interactive = true;
    setTitle();
    const serverUp = () => portOpen(ctx.cfg.port);
    const noUpdates = !!(process.env.JARVIS_NO_UPDATE_CHECK || readEnvFile(ctx.cfg.envFile).JARVIS_NO_UPDATE_CHECK) || fs.existsSync(path.join(appDir, ".git")); // a source checkout updates with git
    if (!noUpdates)
        await offerUpdate(ctx.cfg.dataDir, VERSION, serverUp);
    const TIPS = [
        "Type / for the command menu, or just start typing a tool name.",
        "!git status runs a shell command through the same sandbox and policy.",
        "/tools walks you through any tool's parameters, step by step.",
        "/permissions toggles read, write and terminal access in one menu.",
        "/mcp shows the URL and API key for Copilot Studio, Claude and Cursor.",
        "Tab completes tool names, --options and slash commands.",
        "/doctor checks that git, PowerShell and devtunnel are installed.",
        "/dirs approves another folder without editing any file.",
        "/start runs the MCP server in the background; /stop ends it.",
    ];
    const policy = () => (ctx.cfg.enableTerminal ? (ctx.cfg.allowUnsafe ? "unsafe" : ctx.cfg.terminalMode) : "terminal off");
    const mcpUp0 = await portOpen(ctx.cfg.port);
    const nDirs = ctx.cfg.allowedDirs.length;
    if (cols() >= Math.max(...LOGO.map((l) => l.length)) + 4)
        console.log("\n" + gradient(LOGO.map((l) => `  ${l}`).join("\n")));
    else
        console.log(c.bold(c.accent("\n  ◆ JARVIS")));
    console.log(c.gray(`  v${VERSION}  ·  ${shortPath(ctx.cfg.defaultWorkdir, home, Math.max(10, cols() - 24))}`));
    console.log(`${c.gray(`  ${tools.length} tools · ${nDirs} folder${nDirs === 1 ? "" : "s"} · ${policy()} · MCP server `)}${mcpUp0 ? c.green("● running") : c.gray("○ stopped")}`);
    const notice = launchNotice(ctx.cfg.dataDir, VERSION, { hadSettings: fs.existsSync(ctx.cfg.envFile), settingsDir: shortPath(ctx.cfg.dataDir, home, Math.max(10, cols() - 70)), serverUp: mcpUp0 });
    if (notice)
        console.log(notice.join("\n") + "\n");
    console.log(c.gray(truncate(`  tip: ${TIPS[Math.floor(Math.random() * TIPS.length)]}`, cols())) + "\n");
    /** Live suggestions under the input: slash commands, tool names, or the usage of the tool being typed. */
    const suggestFor = (line) => {
        const t = line.trimStart();
        if (!t || t.startsWith("!"))
            return [];
        const [first = ""] = t.split(/\s+/);
        if (/\s/.test(t)) {
            const tool = tools.find((x) => x.name === first);
            return tool ? [{ label: usage(tool.name, tool.inputSchema).replace(/^jarvis /, ""), value: null }] : [];
        }
        if (first.startsWith("/"))
            return Object.entries(slash).filter(([k]) => k.startsWith(first) && k !== first).map(([k, v]) => ({ label: k, hint: v.hint, value: k }));
        if (first.length < 2)
            return [];
        const n = first.toLowerCase();
        return tools
            .filter((x) => x.name.includes(n) && x.name !== first)
            .sort((a, b) => Number(b.name.startsWith(n)) - Number(a.name.startsWith(n)))
            .map((x) => ({ label: x.name, hint: (x.description ?? "").split("\n")[0], value: x.name }));
    };
    let armed = false; // first Ctrl+C only warns
    for (;;) {
        // no frame around the input: one status line above it (folder, MCP server state, access policy), the main commands below it
        const up = await portOpen(ctx.cfg.port);
        const folder = shortPath(ctx.cfg.defaultWorkdir, home, Math.max(10, Math.min(cols(), 110) - 52));
        const bits = [policy(), ...(ctx.cfg.enableWrite ? [] : ["write off"]), ...(ctx.cfg.enableRead ? [] : ["read off"])].join(" · ");
        console.log(`${c.bold(folder)}${c.gray("  ·  MCP server ")}${up ? c.green("● running") : c.gray("○ stopped")}${c.gray(`  ·  ${bits}`)}`);
        const keys = c.gray(truncate("/ menu · /help · /status · /mcp · /permissions · /theme · /exit", Math.max(10, cols() - 2)));
        const line = await ask(c.accent("❯ "), { history: hist, completer, suggest: suggestFor, footer: keys });
        if (line === null)
            break;
        if (line === SIGINT) {
            if (armed)
                break;
            armed = true;
            console.log(c.dim("(press Ctrl+C again or type /exit to quit)"));
            continue;
        }
        armed = false;
        if (line.trim())
            hist.unshift(line.trim());
        if (await guarded(line))
            break;
        console.log();
    }
    // leaving the prompt does not stop the server: it runs on its own in the background
    if (await portOpen(ctx.cfg.port))
        console.log(c.dim("The MCP server is still running in the background. Stop it with: jarvis stop"));
}
async function main() {
    const raw = process.argv.includes("--raw") || (!isTTY && !process.env.FORCE_COLOR); // FORCE_COLOR = "treat me as a terminal"
    const argv = process.argv.slice(2).filter((a) => a !== "--raw");
    const cmd = argv[0] ?? (isTTY && process.stdin.isTTY ? "shell" : "help"); // bare `jarvis` in a terminal = interactive
    if (["version", "--version", "-v"].includes(cmd))
        return console.log(VERSION), 0;
    if (["help", "--help", "-h"].includes(cmd) && argv.length <= 1)
        return console.log(HELP), 0;
    if (SERVER_CMDS.includes(cmd))
        return serverCommand(cmd, argv, ENTRY);
    if (cmd === "update") {
        const { dataDir } = prepareDataDir();
        return updateCommand(dataDir, VERSION, () => portOpen(loadConfig({ projectDir: appDir, dataDir }).port));
    }
    const { dataDir } = prepareDataDir();
    const ctx = createCtx(loadConfig({ projectDir: appDir, dataDir }));
    setTheme(readEnvFile(ctx.cfg.envFile).JARVIS_THEME ?? process.env.JARVIS_THEME ?? "blue");
    const cwd = realResolve(process.cwd());
    if (isResolvedPathAllowed(ctx.cfg, cwd))
        ctx.cfg.defaultWorkdir = cwd; // CLI: relative paths mean "here", when "here" is allowed
    Object.assign(process.env, enrichEnv(process.env, ctx.cfg.home, readEnvFile(ctx.cfg.envFile)));
    await loadPlugins(ctx);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(ctx).connect(a);
    const client = new Client({ name: "jarvis-cli", version: VERSION });
    await client.connect(b);
    try {
        const { tools } = await client.listTools();
        if (cmd === "shell")
            return await shell(client, tools, ctx), 0;
        return await run(client, tools, argv, raw);
    }
    finally {
        await client.close();
    }
}
main().then((code) => { if (code !== undefined)
    process.exit(code); }, // undefined = keep serving
(e) => { console.error(c.red(`✖ ${e instanceof Error ? e.message : e}`)); process.exit(1); });
