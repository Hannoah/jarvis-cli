/**
 * User plugins: custom_tools/*.mjs|*.js exporting `register(mcp, ctx)` (or `register_tools`).
 * Loaded once at startup; the per-request servers then call each plugin's register function.
 * custom_tools/ is write-protected for the AI tools (config.protectionOf): a plugin runs with the server's full rights.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
export async function loadPlugins(ctx) {
    const dir = path.join(ctx.cfg.projectDir, "custom_tools");
    if (!fs.existsSync(dir))
        return;
    for (const file of fs.readdirSync(dir).filter((f) => /\.(mjs|js)$/.test(f) && !f.startsWith("_")).sort()) {
        try {
            const mod = (await import(pathToFileURL(path.join(dir, file)).href));
            const register = (mod.register ?? mod.register_tools);
            if (typeof register !== "function")
                continue;
            ctx.plugins.push({ name: file, register });
            ctx.customTools.push(file);
            ctx.audit("custom_tools", "LOAD", `Registered tools from ${file}`);
        }
        catch (e) {
            ctx.audit("custom_tools", "ERROR", `Failed to load ${file}: ${e.message}`);
        }
    }
}
