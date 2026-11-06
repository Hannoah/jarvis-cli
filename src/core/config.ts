import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type TerminalMode = "allowlist" | "blocklist";

/** The PC's connection values (API key, tunnel id, URL): one fixed file per OS user, whatever settings folder is in use. See security/identity.ts. */
export const identityFile = (home: string): string => path.join(home, ".jarvis", "identity.json");

export interface Config {
  /** The program folder (code, plugins). */
  projectDir: string;
  /** Everything Jarvis writes: .env, tokens, logs, backups, scheduled scripts, wiki. Defaults to projectDir so tests and old setups behave as before. */
  dataDir: string;
  envFile: string;
  home: string;
  port: number;
  allowedDirs: string[];
  defaultWorkdir: string;
  maxReadBytes: number;
  commandTimeoutSec: number;
  enableRead: boolean;
  enableWrite: boolean;
  enableTerminal: boolean;
  /** Mutating tools advertise readOnlyHint so clients skip approval cards. */
  autoApprove: boolean;
  allowUnsafe: boolean;
  terminalMode: TerminalMode;
  extraAllowedCommands: Set<string>;
  auditLogFile: string;
  tokenStoreFile: string;
  publicUrl: string;
  wikiDir: string;
  /** Total size of all backup snapshots, and the largest single file that is snapshotted. */
  backupMaxTotalBytes: number;
  backupMaxFileBytes: number;
}

/** Parse KEY=VALUE lines (comments, BOM, and simple quotes handled). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let v = line.slice(eq + 1).trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.endsWith(v[0]!)) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

export function readEnvFile(file: string): Record<string, string> {
  try {
    return parseEnv(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** Expand %VAR%, $VAR, ${VAR} and a leading ~ . Unknown variables are left as-is. */
export function expandPath(raw: string, home: string, env: NodeJS.ProcessEnv): string {
  let s = raw.trim();
  s = s.replace(/%([^%]+)%/g, (m, n: string) => env[n] ?? m);
  s = s.replace(/\$\{(\w+)\}|\$(\w+)/g, (m, a?: string, b?: string) => env[(a ?? b)!] ?? m);
  if (s === "~") s = home;
  else if (s.startsWith("~/") || s.startsWith("~\\")) s = path.join(home, s.slice(2));
  return s;
}

/**
 * Like Python's Path.resolve(): absolute, symlinks resolved, but tolerant of paths that do not
 * exist yet (resolves the deepest existing ancestor, then re-appends the rest).
 */
export function realResolve(p: string): string {
  let cur = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(cur);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const bool = (v: string | undefined, dflt: boolean, truthy = ["true"]) =>
  v === undefined ? dflt : truthy.includes(v.toLowerCase());

export interface LoadOptions {
  projectDir: string;
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** .env wins over the process environment (same as the Python server's override=True). */
export function loadConfig(opts: LoadOptions): Config {
  const home = opts.home ?? os.homedir();
  const projectDir = path.resolve(opts.projectDir);
  const dataDir = path.resolve(opts.dataDir ?? opts.projectDir);
  const envFile = path.join(dataDir, ".env");
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env), ...readEnvFile(envFile) };
  const expand = (s: string) => realResolve(expandPath(s, home, env));

  let allowedDirs: string[];
  if (env.PC_MCP_ALLOWED_DIRS !== undefined) {
    // Explicitly set (even to a short list): respect it exactly.
    allowedDirs = env.PC_MCP_ALLOWED_DIRS.split(";").filter((p) => p.trim()).map(expand);
  } else {
    allowedDirs = ["Work", "Desktop", "Downloads", "Documents"]
      .map((d) => path.join(home, d))
      .filter((d) => fs.existsSync(d))
      .map(realResolve);
    if (!allowedDirs.length) allowedDirs = [realResolve(home)];
  }

  let defaultWorkdir: string;
  const wd = (env.PC_MCP_DEFAULT_WORKDIR ?? "").trim();
  const work = path.join(home, "Work");
  if (wd) defaultWorkdir = expand(wd);
  else if (fs.existsSync(work) && allowedDirs.some((d) => isInside(d, realResolve(work)))) defaultWorkdir = realResolve(work);
  else defaultWorkdir = allowedDirs.find((d) => fs.existsSync(d)) ?? allowedDirs[0] ?? realResolve(home);

  const mode = (env.PC_MCP_TERMINAL_MODE ?? "allowlist").trim().toLowerCase();
  return {
    projectDir,
    dataDir,
    envFile,
    home,
    port: Number(env.PC_MCP_PORT) || 8765,
    allowedDirs,
    defaultWorkdir,
    maxReadBytes: 5 * 1024 * 1024,
    commandTimeoutSec: 30,
    enableRead: bool(env.PC_MCP_ENABLE_READ, true),
    enableWrite: bool(env.PC_MCP_ENABLE_WRITE, true),
    enableTerminal: bool(env.PC_MCP_ENABLE_TERMINAL, true),
    autoApprove: bool(env.PC_MCP_AUTO_APPROVE, false, ["true", "1", "yes"]),
    allowUnsafe: bool(env.PC_MCP_ALLOW_UNSAFE, false),
    terminalMode: mode === "blocklist" ? "blocklist" : "allowlist",
    extraAllowedCommands: new Set(
      (env.PC_MCP_EXTRA_ALLOWED_COMMANDS ?? "")
        .split(/[,;]/)
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean),
    ),
    auditLogFile: path.join(dataDir, "audit.log"),
    tokenStoreFile: path.join(dataDir, ".oauth_tokens.json"),
    publicUrl: env.PC_MCP_PUBLIC_URL ?? "",
    backupMaxTotalBytes: 500 * 1024 * 1024,
    backupMaxFileBytes: 50 * 1024 * 1024,
    wikiDir: env.PC_MCP_WIKI_DIR ? expand(env.PC_MCP_WIKI_DIR) : path.join(dataDir, "LLMWiki"),
  };
}

/** True only if an already-resolved target is inside one of the allowed directories (no further I/O). */
export function isResolvedPathAllowed(cfg: Config, resolvedTarget: string): boolean {
  return cfg.allowedDirs.some((a) => isInside(a, resolvedTarget));
}

/** True only if target (after symlink resolution) is inside one of the allowed directories. */
export function isPathAllowed(cfg: Config, target: string): boolean {
  return isResolvedPathAllowed(cfg, realResolve(target));
}

/**
 * The server's own runtime state. Even when the project folder is inside an allowed directory, tools
 * must not be able to read secrets or rewrite policy/logs (otherwise a prompt could set PC_MCP_ALLOW_UNSAFE=true,
 * widen the sandbox, or erase audit.log). Source code is deliberately NOT protected so the AI can still develop Jarvis.
 */
interface GuardPaths {
  dataDir: string;
  secrets: string[];
  states: string[];
}

/**
 * Server-owned paths never change for a given Config, so resolve them once: protectionOf runs
 * per file in searches, and re-resolving eight constant paths every time dominated its cost.
 */
const guardCache = new WeakMap<Config, GuardPaths>();
function guardsOf(cfg: Config): GuardPaths {
  let g = guardCache.get(cfg);
  if (!g) {
    g = {
      dataDir: realResolve(cfg.dataDir),
      secrets: [".env", ".oauth_tokens.json", ".dashboard_token"].map((r) => realResolve(path.join(cfg.dataDir, r))).concat(realResolve(identityFile(cfg.home))),
      states: ["audit.log", ".backups", ".scheduled"]
        .map((r) => realResolve(path.join(cfg.dataDir, r)))
        .concat(realResolve(path.join(cfg.dataDir, "custom_tools"))),
    };
    guardCache.set(cfg, g);
  }
  return g;
}

/** protectionOf for an already-resolved target (no further I/O). */
export function protectionOfResolved(cfg: Config, resolvedTarget: string): "secret" | "state" | null {
  const g = guardsOf(cfg);
  const under = (p: string) => resolvedTarget === p || isInside(p, resolvedTarget);
  if (g.secrets.some(under)) return "secret";
  if (path.dirname(resolvedTarget) === g.dataDir && (resolvedTarget.toLowerCase().endsWith(".log") || /\.log\.\d+$/i.test(resolvedTarget))) return "state"; // audit/server/tunnel/supervisor logs
  if (g.states.some(under)) return "state";
  return null;
}

export function protectionOf(cfg: Config, target: string): "secret" | "state" | null {
  return protectionOfResolved(cfg, realResolve(target));
}
