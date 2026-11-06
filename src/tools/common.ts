import path from "node:path";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { expandPath, isResolvedPathAllowed, protectionOfResolved, realResolve, type Config } from "../core/config.js";
import type { Ctx } from "../core/context.js";

/** Read-only tools skip the client's approval card. */
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** With auto-approve, mutating tools also advertise readOnlyHint so clients run them without asking. */
export function mutating(cfg: Config): ToolAnnotations {
  return cfg.autoApprove
    ? { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    : { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
}

export class SandboxViolationError extends Error {}

/**
 * Resolve a user-supplied path and require it to be inside the allowed directories.
 * mode "write" additionally refuses the server's own state; secrets are unreadable in both modes.
 */
export function resolveSafePath(ctx: Ctx, input: string, tool: string, mode: "read" | "write" = "read"): string {
  const target = realResolve(expandPath(input, ctx.cfg.home, process.env));
  if (!isResolvedPathAllowed(ctx.cfg, target)) {
    ctx.audit(tool, "BLOCKED_PATH", `Attempted access outside sandbox: ${target}`);
    throw new SandboxViolationError(
      `Access denied: '${target}' is outside allowed directories. Allowed directories: [${ctx.cfg.allowedDirs.join(", ")}]`,
    );
  }
  const prot = protectionOfResolved(ctx.cfg, target);
  if (prot === "secret" || (prot === "state" && mode === "write")) {
    ctx.audit(tool, "BLOCKED_PATH", `Attempted access to protected server file (${mode}): ${target}`);
    throw new SandboxViolationError(`Access denied: '${target}' is a protected Jarvis server file.`);
  }
  return target;
}

/** Dev-tool variant: relative paths resolve against the default working directory (not the process cwd). */
export function resolveInWorkdir(ctx: Ctx, input: string, tool: string, mode: "read" | "write" = "read"): string {
  const p = input.trim();
  if (!p) return resolveSafePath(ctx, ctx.cfg.defaultWorkdir, tool, mode);
  const expanded = expandPath(p, ctx.cfg.home, process.env);
  return resolveSafePath(ctx, path.isAbsolute(expanded) ? expanded : path.join(ctx.cfg.defaultWorkdir, expanded), tool, mode);
}

export const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
export const json = (v: unknown) => text(JSON.stringify(v));
