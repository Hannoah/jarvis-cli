#!/usr/bin/env node
// Jarvis CLI: runs the same tools as the jarvis-ts MCP server, in-process (no HTTP, tunnel, OAuth or dashboard).
// Sandbox, command policy and audit log are the tools' own, so behaviour matches the server.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  c, categorize, cmdline, coerce, errorOf, exitCodeOf, isTTY, parseArgs, propType, render, shortPath, suggest, tokenize, toolHelp, truncate, usage,
  type Schema,
} from "./cliutil.js";
import { expandPath, isResolvedPathAllowed, loadConfig, realResolve } from "./core/config.js";
import { createCtx, type Ctx } from "./core/context.js";
import { appDir, prepareDataDir } from "./core/paths.js";
import { VERSION } from "./core/version.js";
import { createMcpServer } from "./server/mcp.js";
import { loadPlugins } from "./server/plugins.js";
import { enrichEnv } from "./system/cliEnv.js";
import { ask, select, SIGINT } from "./tui.js";

const HELP = `${c.bold(`Jarvis CLI ${VERSION}`)}

${c.dim("Usage")}
  jarvis                          interactive mode: prompt, / command menu, guided tool forms
  jarvis ${c.cyan("<tool>")} [args]          run a tool:  jarvis read_file notes.txt
  jarvis ${c.cyan("list")} [filter]          list tools (filter by name or description)
  jarvis ${c.cyan("help")} <tool>            parameters and usage  (also: jarvis <tool> --help)
  jarvis ${c.cyan("shell")}                  same as plain \`jarvis\` (also reads commands from a pipe)
  jarvis ${c.cyan("completion")} <powershell|bash>   print a completion script

${c.dim("Arguments")}
  positional      fill required params first:   jarvis read_file notes.txt 1 20
  --name value    or --name=value; bare --flag = true; arrays/objects take JSON
  --json '{...}'  all arguments as JSON
  --raw           print the tool's exact text (default when piped)

${c.dim("Notes")}
  Settings: ~/.jarvis/.env (or JARVIS_HOME). Relative paths are relative to the current folder when it is allowed.
  Exit codes: 0 ok, 1 tool/runtime error, 2 missing arguments. NO_COLOR disables colors.
`;

type Tools = Awaited<ReturnType<Client["listTools"]>>["tools"];
type Tool = Tools[number];

function list(tools: Tools, rest: string[]): void {
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const q = rest.find((a) => !a.startsWith("--"))?.toLowerCase();
  const shown = tools.filter((t) => !q || t.name.includes(q.replace(/-/g, "_")) || (t.description ?? "").toLowerCase().includes(q));
  if (flags.has("--json")) return void console.log(JSON.stringify(shown.map((t) => ({ name: t.name, description: t.description }))));
  if (flags.has("--names")) return void console.log(shown.map((t) => t.name).join("\n"));
  const w = Math.max(0, ...shown.map((t) => t.name.length));
  const room = (process.stdout.columns ?? 120) - w - 3;
  for (const t of shown) console.log(`${c.cyan(t.name.padEnd(w))}  ${c.dim(truncate((t.description ?? "").split("\n")[0]!, room))}`);
  if (isTTY) console.log(c.dim(`\n${shown.length} tool${shown.length === 1 ? "" : "s"} · jarvis help <tool>`));
  if (!shown.length) console.error(c.yellow(`No tool matches '${q}'.`));
}

const completion = (shell: string, names: string[]): string =>
  shell === "bash"
    ? `complete -W "list help shell completion ${names.join(" ")}" jarvis`
    : `Register-ArgumentCompleter -Native -CommandName jarvis -ScriptBlock {
  param($word, $ast, $pos)
  '${["list", "help", "shell", "completion", ...names].join("','")}' -split ',' | Where-Object { $_ -like "$word*" } |
    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}`;

/** Call a tool and print its result. Returns the process exit code. */
async function execute(client: Client, tool: Tool, args: Record<string, unknown>, raw: boolean): Promise<number> {
  const res = await client.callTool({ name: tool.name, arguments: args });
  let code = res.isError ? 1 : 0;
  for (const part of (res.content ?? []) as { type: string; text?: string }[]) {
    if (part.type !== "text") { console.log(c.dim(`[${part.type} content omitted]`)); continue; }
    const err = errorOf(part.text ?? "");
    if (exitCodeOf(part.text ?? "")) code = 1;
    if (err && !raw) {
      code = 1;
      console.error(c.red(`✖ ${err.message}`));
      if (err.extra) console.error(err.extra);
    } else {
      if (err) code = 1;
      console.log(raw ? part.text : render(part.text ?? ""));
    }
  }
  return code;
}

async function run(client: Client, tools: Tools, argv: string[], raw: boolean): Promise<number> {
  const [cmd = "help", ...rest] = argv;
  if (cmd === "list") return list(tools, rest), 0;
  if (cmd === "completion") {
    if (!["powershell", "bash"].includes(rest[0] ?? "")) return console.error(c.red("✖ Usage: jarvis completion <powershell|bash>")), 2;
    return console.log(completion(rest[0]!, tools.map((t) => t.name))), 0;
  }

  const wanted = cmd === "help" ? rest[0] ?? "" : cmd;
  const tool = tools.find((t) => t.name === wanted.replace(/-/g, "_"));
  if (!tool) {
    const hint = suggest(wanted, tools.map((t) => t.name));
    console.error(c.red(`✖ Unknown tool '${wanted}'.`) + (hint.length ? ` Did you mean: ${hint.map((h) => c.cyan(h)).join(", ")}?` : " Try: jarvis list"));
    return 1;
  }
  const schema = tool.inputSchema as Schema;
  if (cmd === "help") return console.log(toolHelp(tool)), 0;

  const { args, help } = parseArgs(rest, schema);
  if (help) return console.log(toolHelp(tool)), 0;
  const missing = (schema.required ?? []).filter((k) => args[k] === undefined);
  if (missing.length) {
    console.error(c.red(`✖ Missing required: ${missing.map((k) => `--${k}`).join(", ")}`) + `\n${c.dim("Usage:")} ${usage(tool.name, schema)}`);
    return 2;
  }
  return execute(client, tool, args, raw);
}

// ---------- interactive mode ----------

const unquote = (s: string) => s.replace(/^(["'])(.*)\1$/, "$2");

async function shell(client: Client, tools: Tools, ctx: Ctx): Promise<void> {
  const tty = !!process.stdin.isTTY && isTTY;
  const home = os.homedir();
  const cols = () => (process.stdout.columns ?? 80) - 1;
  const hist: string[] = []; // newest first
  const needTTY = () => (tty ? false : (console.error(c.red("✖ This needs an interactive terminal.")), true));

  /** Guided form: required params first, then a menu of optional ones with a Run item on top. */
  async function form(tool: Tool): Promise<void> {
    const schema = tool.inputSchema as Schema;
    const props = schema.properties ?? {};
    const req = schema.required ?? [];
    const args: Record<string, unknown> = {};
    const cancelled = () => console.log(c.dim("cancelled"));

    const setParam = async (k: string): Promise<boolean> => {
      const p = props[k]!;
      const desc = (p.description ?? "").split("\n")[0]!;
      if (desc) console.log(c.dim(`  ${truncate(desc, cols() - 2)}`));
      if (p.enum) {
        const v = await select(k, p.enum.map((e) => ({ label: String(e), value: e })));
        if (v === undefined) return false;
        args[k] = v;
        return true;
      }
      for (;;) {
        const a = await ask(`  ${c.cyan(k)}${req.includes(k) ? c.yellow("*") : ""} ${c.dim(`(${propType(p)})`)}: `);
        if (a === null || a === SIGINT) return false;
        if (!a.trim()) {
          if (req.includes(k)) continue; // required: ask again (Ctrl+C cancels)
          delete args[k];
          return true;
        }
        args[k] = coerce(unquote(a.trim()), p);
        return true;
      }
    };

    console.log(c.bold(tool.name) + c.dim(`  ${truncate((tool.description ?? "").split("\n")[0]!, cols() - tool.name.length - 2)}`));
    for (const k of req) if (!(await setParam(k))) return cancelled();
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
      if (pick === undefined) return cancelled();
      if (pick === "") break;
      if (!(await setParam(pick))) return cancelled();
    }
    console.log(c.dim(`→ ${cmdline(tool.name, args)}`));
    await execute(client, tool, args, false);
  }

  async function browse(): Promise<void> {
    if (needTTY()) return;
    const cats: [string, Tools][] = [["All tools", tools], ...categorize(tools)];
    const group = await select("Tools", cats.map(([name, ts]) => ({ label: name, hint: `${ts.length} tools`, value: ts })));
    if (!group) return;
    const tool = await select(
      "Pick a tool",
      group.map((t) => ({ label: t.name, hint: (t.description ?? "").split("\n")[0], value: t })),
    );
    if (tool) await form(tool);
  }

  async function cd(arg: string): Promise<void> {
    let target = arg.trim();
    if (!target && tty) {
      console.log(c.dim(`  current: ${ctx.cfg.defaultWorkdir}`));
      const a = await ask("  new folder (Enter to keep): ");
      if (typeof a !== "string") return;
      target = a.trim();
    }
    if (!target) return void console.log(ctx.cfg.defaultWorkdir);
    const dir = realResolve(path.resolve(ctx.cfg.defaultWorkdir, expandPath(unquote(target), home, process.env)));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return void console.error(c.red(`✖ Not a folder: ${dir}`));
    if (!isResolvedPathAllowed(ctx.cfg, dir)) return void console.error(c.red(`✖ Outside the allowed folders: ${ctx.cfg.allowedDirs.join(", ")}`));
    ctx.cfg.defaultWorkdir = dir;
    process.chdir(dir); // some tools resolve relative paths against the process cwd, others against the workdir: keep both the same
    console.log(c.dim(`working folder: ${dir}`));
  }

  type Slash = { hint: string; run: (arg: string) => Promise<void | "exit"> };
  const slash: Record<string, Slash> = {
    "/tools": { hint: "Browse tools by category and run one with a guided form", run: browse },
    "/list": { hint: "List tools, optionally filtered: /list git", run: async (a) => list(tools, a ? [a] : []) },
    "/cd": { hint: "Show or change the working folder (must be inside an allowed folder)", run: cd },
    "/env": { hint: "PC environment, allowed folders and policy", run: async () => void (await execute(client, tools.find((t) => t.name === "get_pc_env")!, {}, false)) },
    "/help": {
      hint: "How to use this prompt",
      run: async () =>
        console.log(
          [
            "  <tool> [args]    run a tool, e.g.  read_file notes.txt   (help <tool> for parameters)",
            "  /                command menu (↑↓ + Enter, type to filter)",
            "  /tools           pick a tool and fill in its parameters step by step",
            "  Tab              completes tool names, --options and /commands",
            "  ↑ / ↓            previous commands · Ctrl+C twice or /exit to quit",
          ].map((l) => c.dim(l)).join("\n"),
        ),
    },
    "/clear": { hint: "Clear the screen", run: async () => void console.clear() },
    "/exit": { hint: "Quit", run: async () => "exit" },
  };

  const completer = (line: string): [string[], string] => {
    const toks = line.split(/\s+/);
    const last = toks.at(-1) ?? "";
    if (toks.length <= 1) return [[...Object.keys(slash), "list", "help", "exit", ...tools.map((t) => t.name)].filter((n) => n.startsWith(last)), last];
    const props = Object.keys((tools.find((t) => t.name === toks[0])?.inputSchema as Schema | undefined)?.properties ?? {});
    return [props.map((p) => `--${p}`).filter((f) => f.startsWith(last)), last];
  };

  /** true = quit */
  async function handle(line: string): Promise<boolean> {
    const t = line.trim();
    if (!t) return false;
    if (t === "exit" || t === "quit") return true;
    if (!t.startsWith("/")) return await run(client, tools, tokenize(t), false), false;
    const [name = "", ...rest] = t.split(/\s+/);
    if (name === "/" || name === "/menu") {
      if (needTTY()) return false;
      const pick = await select("Commands", Object.entries(slash).map(([k, v]) => ({ label: k, hint: v.hint, value: k })));
      return pick ? (await slash[pick]!.run("")) === "exit" : false;
    }
    const cmd = slash[name];
    if (!cmd) {
      const hint = suggest(name.slice(1), Object.keys(slash).map((k) => k.slice(1))).map((h) => c.cyan(`/${h}`));
      console.error(c.red(`✖ Unknown command ${name}.`) + (hint.length ? ` Did you mean: ${hint.join(", ")}?` : " Type / for the menu."));
      return false;
    }
    return (await cmd.run(rest.join(" "))) === "exit";
  }

  const guarded = (line: string) =>
    handle(line).catch((e: Error) => (console.error(c.red(`✖ ${e.message}`)), false));

  // Piped input: run each line, no menus (readline would drop buffered lines if reopened per prompt).
  if (!tty) {
    for (const line of fs.readFileSync(0, "utf8").split(/\r?\n/)) if (await guarded(line)) break;
    return;
  }

  const box = [
    `◆ Jarvis ${VERSION}`,
    `  folder  ${shortPath(ctx.cfg.defaultWorkdir, home, 60)}`,
    `  ${tools.length} tools · ${ctx.cfg.allowedDirs.length} allowed folders · terminal: ${ctx.cfg.allowUnsafe ? "unsafe" : ctx.cfg.terminalMode}`,
  ];
  const w = Math.max(...box.map((l) => l.length));
  console.log(c.cyan(`╭${"─".repeat(w + 2)}╮`));
  for (const l of box) console.log(c.cyan("│") + ` ${l.padEnd(w)} ` + c.cyan("│"));
  console.log(c.cyan(`╰${"─".repeat(w + 2)}╯`));
  console.log(c.dim(" Type a tool name to run it · / for the command menu · /tools to browse · Tab completes · Ctrl+C twice to quit\n"));

  let armed = false; // first Ctrl+C only warns
  for (;;) {
    const label = ` ${shortPath(ctx.cfg.defaultWorkdir, home, Math.max(10, cols() - 8))} `;
    console.log(c.dim("──" + label + "─".repeat(Math.max(0, cols() - label.length - 2))));
    const line = await ask(c.green("❯ "), { history: hist, completer });
    if (line === null) break;
    if (line === SIGINT) {
      if (armed) break;
      armed = true;
      console.log(c.dim("(press Ctrl+C again or type /exit to quit)"));
      continue;
    }
    armed = false;
    if (line.trim()) hist.unshift(line.trim());
    if (await guarded(line)) break;
    console.log();
  }
}

async function main(): Promise<number> {
  const raw = process.argv.includes("--raw") || (!isTTY && !process.env.FORCE_COLOR); // FORCE_COLOR = "treat me as a terminal"
  const argv = process.argv.slice(2).filter((a) => a !== "--raw");
  const cmd = argv[0] ?? (isTTY && process.stdin.isTTY ? "shell" : "help"); // bare `jarvis` in a terminal = interactive
  if (["version", "--version", "-v"].includes(cmd)) return console.log(VERSION), 0;
  if (["help", "--help", "-h"].includes(cmd) && argv.length <= 1) return console.log(HELP), 0;

  const { dataDir } = prepareDataDir();
  const ctx = createCtx(loadConfig({ projectDir: appDir, dataDir }));
  const cwd = realResolve(process.cwd());
  if (isResolvedPathAllowed(ctx.cfg, cwd)) ctx.cfg.defaultWorkdir = cwd; // CLI: relative paths mean "here", when "here" is allowed
  Object.assign(process.env, enrichEnv(process.env, ctx.cfg.home));
  await loadPlugins(ctx);

  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(ctx).connect(a);
  const client = new Client({ name: "jarvis-cli", version: VERSION });
  await client.connect(b);
  try {
    const { tools } = await client.listTools();
    if (cmd === "shell") return await shell(client, tools, ctx), 0;
    return await run(client, tools, argv, raw);
  } finally {
    await client.close();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => { console.error(c.red(`✖ ${e instanceof Error ? e.message : e}`)); process.exit(1); },
);
