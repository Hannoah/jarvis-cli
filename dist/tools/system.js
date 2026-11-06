import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { getClipboard, notify, openDefault, setClipboard } from "../system/platform.js";
import { json, mutating, READ_ONLY, resolveSafePath, SandboxViolationError } from "./common.js";
/** Launching these through "open" would run code, not show a document. */
const EXECUTABLE_EXT = new Set([
    ".exe", ".bat", ".cmd", ".vbs", ".vbe", ".ps1", ".msi", ".com", ".scr", ".js", ".jse", ".wsf", ".hta", ".reg", ".lnk",
    ".jar", ".sh", ".command", ".app", ".pkg", ".dmg", ".run", ".appimage", ".desktop",
]);
const gb = (n, d = 1) => Math.round((n / 1024 ** 3) * 10 ** d) / 10 ** d;
export function registerSystemTools(mcp, ctx) {
    const { cfg, audit } = ctx;
    const MUT = mutating(cfg);
    mcp.registerTool("open_in_default_app", {
        description: "Open a file or web URL in the user's default desktop application (e.g. Excel, Word, browser, file manager).",
        inputSchema: { target: z.string().describe("File path inside allowed_directories OR an http/https URL.") },
        annotations: MUT,
    }, async ({ target }) => {
        const clean = target.trim().replace(/^["']+|["']+$/g, "");
        if (/^https?:\/\//i.test(clean)) {
            let url;
            try {
                url = new URL(clean);
            }
            catch {
                return json({ success: false, error: `Invalid URL: ${clean}` });
            }
            openDefault(url.toString());
            audit("open_in_default_app", "ALLOW", `Opened URL: ${url}`);
            return json({ success: true, message: `Opened web URL in default browser: ${url}` });
        }
        let safe;
        try {
            safe = resolveSafePath(ctx, clean, "open_in_default_app");
        }
        catch (e) {
            if (e instanceof SandboxViolationError)
                return json({ success: false, error: e.message });
            throw e;
        }
        if (!fs.existsSync(safe))
            return json({ success: false, error: `Target path does not exist: ${safe}` });
        const ext = path.extname(safe).toLowerCase();
        if (EXECUTABLE_EXT.has(ext)) {
            audit("open_in_default_app", "BLOCKED_POLICY", `Blocked launching executable: ${safe}`);
            return json({ success: false, error: `Executable files (${ext}) cannot be launched via open_in_default_app.` });
        }
        openDefault(safe);
        audit("open_in_default_app", "ALLOW", `Opened ${safe}`);
        return json({ success: true, message: `Opened ${path.basename(safe)} in default application.` });
    });
    mcp.registerTool("manage_clipboard", {
        description: "Read from or write text to the system clipboard.",
        inputSchema: {
            action: z.string().describe("Either 'get' to read clipboard text, or 'set' to copy text to clipboard."),
            text: z.string().optional().describe("Required string text when action is 'set'."),
        },
        annotations: MUT,
    }, async ({ action, text }) => {
        const a = action.toLowerCase().trim();
        if (a === "get") {
            try {
                const content = getClipboard();
                audit("manage_clipboard", "ALLOW", `get_clipboard (${content.length} chars)`);
                return json({ success: true, text: content });
            }
            catch (e) {
                return json({ success: false, error: `Failed to get clipboard: ${e.message}` });
            }
        }
        if (a === "set") {
            if (text === undefined)
                return json({ success: false, error: "Parameter 'text' is required when action is 'set'." });
            try {
                setClipboard(text);
                audit("manage_clipboard", "ALLOW", `set_clipboard (${text.length} chars)`);
                return json({ success: true, message: `Successfully copied ${text.length} characters to clipboard.` });
            }
            catch (e) {
                return json({ success: false, error: `Failed to set clipboard: ${e.message}` });
            }
        }
        return json({ success: false, error: `Invalid action: '${action}'. Must be 'get' or 'set'.` });
    });
    mcp.registerTool("send_notification", {
        description: "Display a native desktop notification popup on the user's desktop.",
        inputSchema: {
            title: z.string().describe('Notification header title (e.g. "Report Generation Complete").'),
            message: z.string().describe("Notification message body."),
        },
        annotations: MUT,
    }, async ({ title, message }) => {
        const t = title.trim().slice(0, 100);
        const m = message.trim().slice(0, 300);
        try {
            notify(t, m);
            audit("send_notification", "ALLOW", `title='${t}'`);
            return json({ success: true, message: `Notification '${t}' displayed.` });
        }
        catch (e) {
            return json({ success: false, error: `Failed to send notification: ${e.message}` });
        }
    });
    mcp.registerTool("get_system_status", { description: "Retrieve local PC performance and resource metrics (RAM, Disk usage, OS info).", annotations: READ_ONLY }, async () => {
        const disks = {};
        for (const p of cfg.allowedDirs.length ? cfg.allowedDirs : [os.homedir()]) {
            try {
                const root = path.parse(p).root || p;
                if (root in disks)
                    continue;
                const s = fs.statfsSync(p);
                const total = s.blocks * s.bsize;
                const free = s.bavail * s.bsize;
                const used = total - s.bfree * s.bsize;
                disks[root] = { total_gb: gb(total), free_gb: gb(free), used_percent: Math.round((used / total) * 1000) / 10 };
            }
            catch {
                /* skip unreadable volume */
            }
        }
        const total = os.totalmem();
        const free = os.freemem();
        const cpus = os.cpus();
        const uptimeSec = os.uptime();
        const uptimeStr = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;
        audit("get_system_status", "ALLOW", "Fetched system status");
        return json({
            os: `${os.type()} ${os.release()} ${os.arch()}`,
            hostname: os.hostname(),
            uptime: uptimeStr,
            cpu: {
                cores: cpus.length,
                model: cpus[0]?.model || "unknown",
            },
            disk_storage: disks,
            memory_ram: { total_gb: gb(total, 2), available_gb: gb(free, 2), used_percent: Math.round(((total - free) / total) * 100) },
        });
    });
}
