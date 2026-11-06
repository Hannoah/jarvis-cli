import { createAudit } from "./audit.js";
import { createBackups } from "../files/backup.js";
import { createJobs } from "../system/jobs.js";
export function createCtx(cfg, audit = createAudit(cfg.auditLogFile)) {
    const ctx = { cfg, audit, customTools: [], plugins: [], jobs: createJobs() };
    ctx.backups = createBackups(ctx);
    return ctx;
}
