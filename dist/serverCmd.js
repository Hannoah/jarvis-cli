// Server-side commands: start / serve / stop / status / tunnel / dirs / permissions / allowlist / mcp / open / install.
// Split out of cli.ts, which keeps the tool runner and the interactive prompt. `entry` is cli.js, which background and autostart re-launch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adminCommand, dashboardAccess, foreignMessage, startBackground } from "./admin.js";
import { c } from "./cliutil.js";
import { loadConfig, readEnvFile } from "./core/config.js";
import { installFatalHandlers } from "./core/fatal.js";
import { appDir, prepareDataDir } from "./core/paths.js";
import { VERSION } from "./core/version.js";
import { startSupervisor } from "./supervisor/index.js";
import { install, uninstall } from "./system/autostart.js";
import { openDefault } from "./system/platform.js";
export const SERVER_CMDS = ["start", "serve", "open", "url", "install", "uninstall", "status", "stop", "restart", "tunnel", "dirs", "permissions", "allowlist", "mcp", "identity"];
/** Returns an exit code, or undefined when the process should keep running (server / supervisor). */
export async function serverCommand(cmd, argv, entry) {
    const { dataDir } = prepareDataDir();
    const flag = (f) => argv.includes(f);
    const dashboardUrl = () => {
        const tokenFile = path.join(dataDir, ".dashboard_token");
        if (!fs.existsSync(tokenFile))
            return null;
        const port = Number(readEnvFile(loadConfig({ projectDir: dataDir }).envFile).JARVIS_DASHBOARD_PORT) || 8766;
        return `http://127.0.0.1:${port}/?token=${fs.readFileSync(tokenFile, "utf8").trim()}`;
    };
    switch (cmd) {
        case "serve":
            await import("./main.js");
            return undefined;
        case "status":
        case "stop":
        case "restart":
        case "tunnel":
        case "dirs":
        case "permissions":
        case "allowlist":
        case "mcp":
        case "identity":
            process.exitCode = await adminCommand(cmd, argv.slice(1), loadConfig({ projectDir: appDir, dataDir }));
            return undefined; // let the event loop drain: process.exit() right after network calls can crash on Windows
        case "open":
        case "url": {
            const url = dashboardUrl();
            if (!url)
                return console.error(c.red("✖ No dashboard token yet. Run `jarvis start` once.")), 1;
            if (cmd === "url")
                console.log(url);
            else
                (openDefault(url), console.log("Opening the dashboard. Afterwards this browser can use it directly."));
            return 0;
        }
        case "install":
        case "uninstall": {
            const input = { node: process.execPath, entry, projectDir: dataDir, home: os.homedir() };
            const r = cmd === "install" ? install(input) : uninstall(input);
            console.log(r.ok ? c.green(`✔ ${r.message}`) : c.red(`✖ ${r.message}`));
            if (r.ok) {
                console.log(c.gray(cmd === "install"
                    ? "  Jarvis will start by itself at your next login.\n  Start it now: jarvis start -d   ·   check: jarvis status   ·   undo: jarvis uninstall"
                    : "  Jarvis will no longer start at login. A server that is running keeps running: jarvis stop"));
            }
            return r.ok ? 0 : 1;
        }
        default: {
            // start
            if (flag("-d") || flag("--background")) {
                process.exitCode = await startBackground(loadConfig({ projectDir: appDir, dataDir }), entry, flag("--no-tunnel") ? ["--no-tunnel"] : []);
                return undefined;
            }
            installFatalHandlers("supervisor");
            let sup;
            try {
                sup = await startSupervisor({ projectDir: dataDir, tunnel: !flag("--no-tunnel") });
            }
            catch (e) {
                if (e.code !== "EADDRINUSE")
                    throw e;
                // already running is not an error: show the existing dashboard
                const url = dashboardUrl() ?? "";
                const port = Number(readEnvFile(loadConfig({ projectDir: dataDir }).envFile).JARVIS_DASHBOARD_PORT) || 8766;
                // Is it really ours? Ours answers 401 with its sign-in page when asked without a token.
                const ours = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) }).then(async (r) => r.status === 401 && (await r.text()).includes("Jarvis"), () => false);
                if (!ours)
                    throw new Error(`Port ${port} is in use by another program (not this Jarvis). Set JARVIS_DASHBOARD_PORT in ${path.join(dataDir, ".env")}.`);
                const here = loadConfig({ projectDir: appDir, dataDir });
                if ((await dashboardAccess(here)) === "foreign")
                    return console.error(c.red(`✖ ${foreignMessage(here)}`)), 1; // its dashboard would reject our token: opening our URL only shows a 401 page
                console.log("Jarvis is already running — opening the dashboard.");
                if (!flag("--no-open"))
                    openDefault(url);
                return 0;
            }
            console.log(`Jarvis ${VERSION}
Dashboard: ${sup.dashboardUrl}
(Ctrl+C to stop)`);
            if (!flag("--no-open"))
                openDefault(sup.dashboardUrl);
            let stopping = false;
            const shutdown = async () => {
                if (stopping)
                    return;
                stopping = true;
                await sup.stop();
                process.exit(0);
            };
            process.on("SIGINT", shutdown);
            process.on("SIGTERM", shutdown);
            return undefined;
        }
    }
}
