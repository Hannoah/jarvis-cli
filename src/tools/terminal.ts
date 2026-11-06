import { spawn } from "node:child_process";
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isPathAllowed, protectionOf, type Config } from "../core/config.js";
import type { Ctx } from "../core/context.js";
import { CommandPolicyError, DEFAULT_ALLOWED_COMMANDS, checkCommand, psExecutable } from "../security/policy.js";
import { killTree } from "../system/proc.js";
import { json, resolveSafePath, SandboxViolationError } from "./common.js";

/**
 * Dangerous patterns refused outright (legacy guard, applies in every mode unless PC_MCP_ALLOW_UNSAFE=true).
 * Command names must start a word: `dotnet user-secrets` is not `net user`, and `ruff format .` is not `format C:`.
 */
export const BLOCKED_COMMAND_PATTERNS: readonly RegExp[] = [
  /(?<![\w.-])format\s+[a-z]:/,
  /(?<![\w.-])diskpart\b/,
  /(?<![\w.-])rd \/s \/q c:\\/,
  /remove-item -recurse -force c:\\/,
  /rm -rf \//,
  /(?<![\w.-])cipher \/w:/,
  /(?<![\w.-])reg delete\b/,
  /(?<![\w.-])net user\b/,
  /(?<![\w.-])sc delete\b/,
];

const MAX_OUTPUT = 1024 * 1024; // per stream; a runaway command must not exhaust memory

export function allowedCommands(cfg: Config): Set<string> {
  return new Set([...DEFAULT_ALLOWED_COMMANDS, ...cfg.extraAllowedCommands]);
}

function blockedPattern(cfg: Config, command: string): string | null {
  if (cfg.allowUnsafe) return null;
  const c = command.toLowerCase().trim();
  for (const p of BLOCKED_COMMAND_PATTERNS) {
    const m = p.exec(c);
    if (m) return m[0];
  }
  return null;
}

function runShell(command: string, cwd: string, timeoutSec: number): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const wrapped = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`;
    const child = spawn(psExecutable(), ["-NoProfile", "-NonInteractive", "-Command", wrapped], {
      cwd,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outSize = 0;
    let errSize = 0;
    let truncated = false;
    const keep = (arr: Buffer[], size: number, chunk: Buffer): number => {
      if (size >= MAX_OUTPUT) {
        truncated = true;
        return size;
      }
      arr.push(chunk.subarray(0, MAX_OUTPUT - size));
      if (size + chunk.length > MAX_OUTPUT) truncated = true;
      return size + chunk.length;
    };
    child.stdout!.on("data", (c: Buffer) => (outSize = keep(out, outSize, c)));
    child.stderr!.on("data", (c: Buffer) => (errSize = keep(err, errSize, c)));

    let done = false;
    const finish = (r: Record<string, unknown>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      killTree(child);
      finish({ success: false, exit_code: -1, error: `Command timed out after ${timeoutSec} seconds.` });
    }, timeoutSec * 1000);

    child.on("error", (e) => finish({ success: false, exit_code: -1, error: e.message }));
    child.on("close", (code) => {
      const note = truncated ? `\n[output truncated at ${MAX_OUTPUT} bytes]` : "";
      finish({
        success: code === 0,
        exit_code: code,
        cwd,
        stdout: Buffer.concat(out).toString("utf8").trim() + note,
        stderr: Buffer.concat(err).toString("utf8").trim(),
      });
    });
  });
}

/**
 * The shared pre-flight for anything that runs a user-supplied command (run_terminal, background jobs, scheduled tasks):
 * legacy pattern guard, then the AST allowlist policy. Returns an error message, or null when the command may run.
 */
export async function gateCommand(ctx: Ctx, tool: string, command: string, workDir: string): Promise<string | null> {
  const { cfg, audit } = ctx;
  const blocked = blockedPattern(cfg, command);
  if (blocked) {
    audit(tool, "BLOCKED_CMD", `Blocked pattern '${blocked}' in command: ${command}`);
    return `Command blocked by safety guard (matched pattern: '${blocked}').`;
  }
  if (cfg.terminalMode === "allowlist" && !cfg.allowUnsafe) {
    try {
      await checkCommand(command, workDir, { isAllowed: (p) => isPathAllowed(cfg, p), isProtected: (p) => protectionOf(cfg, p) !== null, isSecret: (p) => protectionOf(cfg, p) === "secret", home: cfg.home }, allowedCommands(cfg));
    } catch (e) {
      const msg = (e as Error).message;
      if (e instanceof CommandPolicyError) {
        audit(tool, "BLOCKED_POLICY", `${msg} | cwd=${workDir} | cmd=${command}`);
        return `Command blocked by allowlist policy: ${msg}`;
      }
      audit(tool, "BLOCKED_POLICY", `Policy check failed (${msg}) | cmd=${command}`); // fail closed
      return `Command blocked: policy check failed (${msg})`;
    }
  }
  return null;
}

export function registerTerminalTool(mcp: McpServer, ctx: Ctx): void {
  const { cfg, audit } = ctx;
  const fail = (error: string) => json({ success: false, exit_code: -1, error });

  mcp.registerTool(
    "run_terminal",
    {
      description: "Execute a PowerShell command inside an allowed working directory.",
      inputSchema: {
        command: z.string().describe("PowerShell command string to execute."),
        cwd: z.string().optional().describe("Optional working directory (must be within allowed_directories; defaults to default_workdir)."),
        timeout: z.number().int().default(cfg.commandTimeoutSec).describe("Maximum execution wait time in seconds (default 30)."),
      },
      annotations: { readOnlyHint: cfg.autoApprove, destructiveHint: !cfg.autoApprove, idempotentHint: false, openWorldHint: true },
    },
    async ({ command, cwd, timeout }) => {
      if (!cfg.enableTerminal) {
        audit("run_terminal", "BLOCKED_POLICY", `Terminal disabled by policy: ${command}`);
        return fail("Terminal execution is disabled by security policy (PC_MCP_ENABLE_TERMINAL=false).");
      }
      // cheap pattern guard first, so an obviously bad command never costs a PowerShell parse
      const blocked = blockedPattern(cfg, command);
      if (blocked) {
        audit("run_terminal", "BLOCKED_CMD", `Blocked pattern '${blocked}' in command: ${command}`);
        return fail(`Command blocked by safety guard (matched pattern: '${blocked}').`);
      }

      let workDir: string;
      try {
        workDir = cwd ? resolveSafePath(ctx, cwd, "run_terminal") : cfg.defaultWorkdir;
      } catch (e) {
        if (e instanceof SandboxViolationError) return fail(e.message);
        throw e;
      }
      if (!fs.existsSync(workDir) || !fs.statSync(workDir).isDirectory()) return fail(`Working directory does not exist: ${workDir}`);

      const denied = await gateCommand(ctx, "run_terminal", command, workDir);
      if (denied) return fail(denied);

      const effective = Math.max(1, Math.min(timeout, 300));
      audit("run_terminal", "ALLOW", `cwd=${workDir} | cmd=${command}`);
      return json(await runShell(command, workDir, effective));
    },
  );
}
