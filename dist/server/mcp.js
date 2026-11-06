import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "../core/version.js";
import { json, READ_ONLY } from "../tools/common.js";
import { registerAllTools } from "../tools/index.js";
import { allowedCommands } from "../tools/terminal.js";
const INSTRUCTIONS = "A corporate-safe MCP server that grants controlled access to the local PC. " +
    "File access and terminal working directories are restricted to `allowed_directories`. " +
    "Always call `get_pc_env` first to check allowed folder paths. " +
    "[WIKI MEMORY RULES] A persistent knowledge base lives in `LLMWiki/`. To stay token-efficient, do NOT load " +
    "everything. At the START of a session call `wiki_index` once to see the lightweight table of contents. When you " +
    "need details, use `wiki_search` to find WHICH document/line is relevant, then `wiki_read` to open ONLY that " +
    "document. When you learn durable knowledge (solved problems, decisions, user preferences, project state), " +
    "persist it with `wiki_append` (or `wiki_create` for a new topic). This keeps long-term memory current while " +
    "minimizing context usage.";
// One server per request (stateless transport), so keep construction cheap.
export function createMcpServer(ctx) {
    const mcp = new McpServer({ name: "Jarvis", version: VERSION }, { instructions: INSTRUCTIONS });
    const { cfg } = ctx;
    mcp.registerTool("get_pc_env", {
        description: "Get PC environment info, allowed sandbox directories, and security policy status. " +
            "Call this tool first to see which directories you are permitted to access.",
        annotations: READ_ONLY,
    }, async () => {
        ctx.audit("get_pc_env", "ALLOW", "Fetched PC environment and allowed directories");
        return json({
            version: VERSION,
            hostname: os.hostname(),
            username: process.env.USERNAME ?? process.env.USER ?? os.userInfo().username,
            os: `${os.type()} ${os.release()} (${os.version()})`,
            security_policy: {
                sandbox_enabled: true,
                allowed_directories: cfg.allowedDirs,
                default_workdir: cfg.defaultWorkdir,
                file_read_enabled: cfg.enableRead,
                file_write_enabled: cfg.enableWrite,
                terminal_enabled: cfg.enableTerminal,
                auto_approve_enabled: cfg.autoApprove,
                terminal_mode: cfg.allowUnsafe ? "unsafe" : cfg.terminalMode,
                allowed_commands: cfg.terminalMode === "allowlist" ? [...allowedCommands(cfg)].sort() : null,
                custom_tools: ctx.customTools,
                audit_log: cfg.auditLogFile,
            },
        });
    });
    registerAllTools(mcp, ctx);
    return mcp;
}
