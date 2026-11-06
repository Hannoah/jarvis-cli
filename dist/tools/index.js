import { registerDevTools } from "./dev.js";
import { registerEnterpriseTools } from "./enterprise.js";
import { registerFileTools } from "./files.js";
import { registerSystemTools } from "./system.js";
import { registerTerminalTool } from "./terminal.js";
import { registerWikiTools } from "./wiki.js";
export function registerAllTools(mcp, ctx) {
    registerFileTools(mcp, ctx);
    registerTerminalTool(mcp, ctx);
    registerSystemTools(mcp, ctx);
    registerWikiTools(mcp, ctx);
    registerDevTools(mcp, ctx);
    registerEnterpriseTools(mcp, ctx);
    for (const p of ctx.plugins)
        p.register(mcp, ctx);
}
