import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "../core/context.js";
import { registerDevTools } from "./dev.js";
import { registerEnterpriseTools } from "./enterprise.js";
import { registerFileTools } from "./files.js";
import { registerSystemTools } from "./system.js";
import { registerTerminalTool } from "./terminal.js";
import { registerVpnTools } from "./vpn.js";
import { registerWikiTools } from "./wiki.js";

export function registerAllTools(mcp: McpServer, ctx: Ctx): void {
  registerFileTools(mcp, ctx);
  registerTerminalTool(mcp, ctx);
  registerSystemTools(mcp, ctx);
  registerWikiTools(mcp, ctx);
  registerDevTools(mcp, ctx);
  registerEnterpriseTools(mcp, ctx);
  registerVpnTools(mcp, ctx);
  for (const p of ctx.plugins) p.register(mcp, ctx);
}
