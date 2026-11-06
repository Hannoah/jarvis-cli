import { createAudit, type Audit } from "./audit.js";
import { createBackups, type Backups } from "../files/backup.js";
import type { Config } from "./config.js";
import { createJobs, type Jobs } from "../system/jobs.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Everything a tool needs. Passed explicitly (no module-level singletons) so tests can build isolated ones. */
export interface Ctx {
  cfg: Config;
  audit: Audit;
  backups: Backups;
  jobs: Jobs;
  /** Loaded user plugins (custom_tools/*.mjs). Each registers extra tools on every per-request server. */
  plugins: { name: string; register(mcp: McpServer, ctx: Ctx): void }[];
  /** Names of user plugins that loaded successfully (reported by get_pc_env). */
  customTools: string[];
}

export function createCtx(cfg: Config, audit: Audit = createAudit(cfg.auditLogFile)): Ctx {
  const ctx = { cfg, audit, customTools: [], plugins: [], jobs: createJobs() } as unknown as Ctx;
  ctx.backups = createBackups(ctx);
  return ctx;
}
