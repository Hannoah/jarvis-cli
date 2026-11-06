#!/usr/bin/env node
// Jarvis CLI: runs the same tools as the jarvis-ts MCP server, in-process (no HTTP, tunnel, OAuth or dashboard).
// Sandbox, command policy and audit log are the tools' own, so behaviour matches the server.
import readline from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { c, errorOf, exitCodeOf, isTTY, parseArgs, render, suggest, tokenize, toolHelp, truncate, usage } from "./cliutil.js";
import { isResolvedPathAllowed, loadConfig, realResolve } from "./core/config.js";
import { createCtx } from "./core/context.js";
import { appDir, prepareDataDir } from "./core/paths.js";
import { VERSION } from "./core/version.js";
import { createMcpServer } from "./server/mcp.js";
import { loadPlugins } from "./server/plugins.js";
import { enrichEnv } from "./system/cliEnv.js";
const HELP = `${c.bold(`Jarvis CLI ${VERSION}`)}

${c.dim("Usage")}
  jarvis ${c.cyan("<tool>")} [args]          run a tool:  jarvis read_file notes.txt
  jarvis ${c.cyan("list")} [filter]          list tools (filter by name or description)
  jarvis ${c.cyan("help")} <tool>            parameters and usage  (also: jarvis <tool> --help)
  jarvis ${c.cyan("shell")}                  interactive session with history and Tab completion
  jarvis ${c.cyan("completion")} <powershell|bash>   print a completion script

${c.dim("Arguments")}
  positional      fill required params first:   jarvis read_file notes.txt 1 20
  --name value    or --name=value; bare --flag = true; arrays/objects take JSON
  --json '{...}'  all arguments as JSON
  --raw           print the tool's exact text (default when piped)

${c.dim("Notes")}
  Settings: <app>/data/.env (or JARVIS_HOME). Relative paths are relative to the current folder when it is allowed.
  Exit codes: 0 ok, 1 tool/runtime error, 2 missing arguments. NO_COLOR disables colors.
`;
function list(tools, rest) {
    const flags = new Set(rest.filter((a) => a.startsWith("--")));
    const q = rest.find((a) => !a.startsWith("--"))?.toLowerCase();
    const shown = tools.filter((t) => !q || t.name.includes(q.replace(/-/g, "_")) || (t.description ?? "").toLowerCase().includes(q));
    if (flags.has("--json"))
        return void console.log(JSON.stringify(shown.map((t) => ({ name: t.name, description: t.description }))));
    if (flags.has("--names"))
        return void console.log(shown.map((t) => t.name).join("\n"));
    const w = Math.max(0, ...shown.map((t) => t.name.length));
    const room = (process.stdout.columns ?? 120) - w - 3;
    for (const t of shown)
        console.log(`${c.cyan(t.name.padEnd(w))}  ${c.dim(truncate((t.description ?? "").split("\n")[0], room))}`);
    if (isTTY)
        console.log(c.dim(`\n${shown.length} tool${shown.length === 1 ? "" : "s"} · jarvis help <tool>`));
    if (!shown.length)
        console.error(c.yellow(`No tool matches '${q}'.`));
}
const completion = (shell, names) => shell === "bash"
    ? `complete -W "list help shell completion ${names.join(" ")}" jarvis`
    : `Register-ArgumentCompleter -Native -CommandName jarvis -ScriptBlock {
  param($word, $ast, $pos)
  '${["list", "help", "shell", "completion", ...names].join("','")}' -split ',' | Where-Object { $_ -like "$word*" } |
    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}`;
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
    const res = await client.callTool({ name: tool.name, arguments: args });
    let code = res.isError ? 1 : 0;
    for (const part of (res.content ?? [])) {
        if (part.type !== "text") {
            console.log(c.dim(`[${part.type} content omitted]`));
            continue;
        }
        const err = errorOf(part.text ?? "");
        if (exitCodeOf(part.text ?? ""))
            code = 1;
        if (err && !raw) {
            code = 1;
            console.error(c.red(`✖ ${err.message}`));
            if (err.extra)
                console.error(err.extra);
        }
        else {
            if (err)
                code = 1;
            console.log(raw ? part.text : render(part.text ?? ""));
        }
    }
    return code;
}
async function shell(client, tools) {
    const names = ["list", "help", "exit", ...tools.map((t) => t.name)];
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: c.green("jarvis> "),
        completer: (line) => {
            const toks = line.split(/\s+/);
            const last = toks.at(-1) ?? "";
            if (toks.length <= 1)
                return [names.filter((n) => n.startsWith(last)), last];
            const props = Object.keys(tools.find((t) => t.name === toks[0])?.inputSchema?.properties ?? {});
            return [props.map((p) => `--${p}`).filter((f) => f.startsWith(last)), last];
        },
    });
    if (isTTY)
        console.log(c.dim(`Jarvis ${VERSION} — Tab completes, 'help <tool>' explains, 'exit' quits.`));
    rl.prompt();
    for await (const line of rl) {
        const t = line.trim();
        if (t === "exit" || t === "quit")
            break;
        if (t)
            await run(client, tools, tokenize(t), false).catch((e) => console.error(c.red(`✖ ${e.message}`)));
        rl.prompt();
    }
    rl.close();
}
async function main() {
    const raw = process.argv.includes("--raw") || (!isTTY && !process.env.FORCE_COLOR); // FORCE_COLOR = "treat me as a terminal"
    const argv = process.argv.slice(2).filter((a) => a !== "--raw");
    const cmd = argv[0] ?? "help";
    if (["version", "--version", "-v"].includes(cmd))
        return console.log(VERSION), 0;
    if (["help", "--help", "-h"].includes(cmd) && argv.length <= 1)
        return console.log(HELP), 0;
    const { dataDir } = prepareDataDir();
    const ctx = createCtx(loadConfig({ projectDir: appDir, dataDir }));
    const cwd = realResolve(process.cwd());
    if (isResolvedPathAllowed(ctx.cfg, cwd))
        ctx.cfg.defaultWorkdir = cwd; // CLI: relative paths mean "here", when "here" is allowed
    Object.assign(process.env, enrichEnv(process.env, ctx.cfg.home));
    await loadPlugins(ctx);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(ctx).connect(a);
    const client = new Client({ name: "jarvis-cli", version: VERSION });
    await client.connect(b);
    try {
        const { tools } = await client.listTools();
        if (cmd === "shell")
            return await shell(client, tools), 0;
        return await run(client, tools, argv, raw);
    }
    finally {
        await client.close();
    }
}
main().then((code) => process.exit(code), (e) => { console.error(c.red(`✖ ${e instanceof Error ? e.message : e}`)); process.exit(1); });
