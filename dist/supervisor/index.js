import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timestamp } from "../core/audit.js";
import { getOrCreateApiKey } from "../security/auth.js";
import { loadConfig, readEnvFile } from "../core/config.js";
import { killTree, portOpen, portOwnerPid, sleep } from "../system/proc.js";
import { VERSION } from "../core/version.js";
import { createDashboard } from "./dashboard.js";
import { Service } from "./service.js";
import { readIdentity, setIdentity, syncIdentity } from "../security/identity.js";
import { Tunnel } from "./tunnel.js";
/** Persistent secret for the dashboard URL (kept in a protected file so bookmarks survive restarts). */
function dashboardToken(projectDir) {
    const f = path.join(projectDir, ".dashboard_token");
    try {
        const t = fs.readFileSync(f, "utf8").trim();
        if (t.length >= 32)
            return t;
    }
    catch {
        /* create below */
    }
    const t = crypto.randomBytes(32).toString("base64url");
    fs.writeFileSync(f, t, { encoding: "utf8", mode: 0o600 });
    return t;
}
export function trimLog(file, maxBytes = 2 * 1024 * 1024) {
    try {
        if (fs.statSync(file).size > maxBytes) {
            const keep = fs.readFileSync(file).subarray(-Math.floor(maxBytes / 4));
            fs.writeFileSync(file, keep);
        }
    }
    catch {
        /* no file yet */
    }
}
export async function startSupervisor(opts) {
    const projectDir = path.resolve(opts.projectDir);
    const cfg = loadConfig({ projectDir });
    getOrCreateApiKey(cfg);
    const dashboardPort = opts.dashboardPort ?? (Number(readEnvFile(cfg.envFile).JARVIS_DASHBOARD_PORT) || 8766);
    const supLog = path.join(projectDir, "supervisor.log");
    trimLog(supLog);
    const log = (m) => {
        try {
            fs.appendFileSync(supLog, `[${timestamp()}] ${m}\n`, "utf8");
        }
        catch {
            /* logging must never crash the supervisor */
        }
    };
    for (const k of syncIdentity(cfg.envFile, cfg.home))
        log(`[identity] ${k} in this settings folder differed from the PC's value; restored`);
    for (const f of ["server.out.log", "server.err.log", "tunnel.log"])
        trimLog(path.join(projectDir, f));
    const errLog = path.join(projectDir, "server.err.log");
    if (fs.existsSync(errLog))
        fs.copyFileSync(errLog, path.join(projectDir, "server.err.prev.log")); // keep the last run's crash trace
    // The MCP server is this same package's main entry, run with the same loader (tsx in dev, plain node when built).
    const here = path.dirname(fileURLToPath(import.meta.url));
    const ext = path.extname(fileURLToPath(import.meta.url));
    const mainEntry = path.resolve(here, "..", `main${ext}`);
    const server = new Service({
        name: "server",
        spawnSpec: () => {
            const custom = opts.serverSpec?.();
            return {
                cmd: custom?.cmd ?? process.execPath,
                args: custom?.args ?? [...process.execArgv, mainEntry],
                cwd: projectDir,
                env: { ...process.env, JARVIS_HOME: projectDir },
            };
        },
        ready: () => portOpen(loadConfig({ projectDir }).port),
        logOut: path.join(projectDir, "server.out.log"),
        logErr: errLog,
        log,
    });
    const tunnel = new Tunnel({
        port: cfg.port,
        home: cfg.home,
        getTunnelId: () => readEnvFile(cfg.envFile).PC_MCP_DEVTUNNEL_ID ?? "",
        onUpdate: (info) => applyTunnelUpdate(cfg.envFile, cfg.home, info, () => server.state !== "stopped" && void server.restart().catch((e) => log(`[server] restart failed: ${e.message}`)), log),
        log,
        logFile: path.join(projectDir, "tunnel.log"),
        cli: opts.tunnelCli,
    });
    const token = dashboardToken(projectDir);
    const stopAll = async () => {
        await tunnel.stop();
        await server.stop();
        await new Promise((r) => dash.close(() => r()));
        log("supervisor stopped");
    };
    const dash = createDashboard({ projectDir, version: VERSION, token, port: dashboardPort, server, tunnel, log, shutdown: () => void stopAll().then(() => process.exit(0)) });
    await new Promise((resolve, reject) => {
        dash.once("error", reject);
        dash.listen(dashboardPort, "127.0.0.1", () => resolve());
    });
    const addr = dash.address();
    const actualPort = typeof addr === "object" && addr ? addr.port : dashboardPort;
    const dashboardUrl = `http://127.0.0.1:${actualPort}/?token=${token}`;
    log(`supervisor v${VERSION} up; dashboard on port ${actualPort}`);
    await clearOrphanServer(cfg.port, log);
    process.on("exit", Service.killAll);
    await server.start();
    const wantTunnel = opts.tunnel !== false && (readEnvFile(cfg.envFile).JARVIS_TUNNEL ?? "").toLowerCase() !== "off";
    if (wantTunnel)
        void tunnel.ensure().catch((e) => log(`[tunnel] ${e.message}`));
    return {
        dashboardUrl,
        token,
        server,
        tunnel,
        stop: stopAll,
    };
}
/**
 * Persist the tunnel id/URL. The server reads PC_MCP_PUBLIC_URL only at startup (OAuth metadata, /health), and it is
 * usually up before the tunnel reports its URL, so a changed URL needs one server restart to take effect.
 */
export function applyTunnelUpdate(envFile, home, info, restartServer, log = () => undefined) {
    const before = (readEnvFile(envFile).PC_MCP_PUBLIC_URL ?? "").trim();
    const known = readIdentity(home).tunnelId;
    const patch = {};
    if (!known)
        patch.tunnelId = info.id; // the first tunnel this PC ever got
    else if (known !== info.id)
        log(`[tunnel] ignored tunnel id ${info.id}: this PC's tunnel is ${known} (change it on purpose in the dashboard)`);
    if (info.url)
        patch.publicUrl = info.url; // observed: whatever the PC's tunnel reports
    if (Object.keys(patch).length)
        setIdentity(envFile, home, patch);
    if (info.url && info.url !== before) {
        log(`[tunnel] public URL changed; restarting server to apply it`);
        restartServer();
    }
}
/**
 * A previous supervisor that was force-killed leaves its server running, and the new one would crash-loop on EADDRINUSE.
 * Only a process that answers /health as "Jarvis" on OUR port is stopped; anything else is left alone and reported.
 */
export async function clearOrphanServer(port, log) {
    if (!(await portOpen(port)))
        return;
    let isJarvis = false;
    try {
        const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
        isJarvis = (await r.json()).name === "Jarvis";
    }
    catch {
        /* not ours */
    }
    if (!isJarvis)
        return log(`port ${port} is in use by something that is not Jarvis; leaving it alone`);
    const pid = portOwnerPid(port);
    if (!pid || pid === process.pid)
        return;
    log(`stopping orphaned Jarvis server pid ${pid} on port ${port}`);
    killTree({ pid, kill: () => false });
    for (let i = 0; i < 20 && (await portOpen(port)); i++)
        await sleep(250);
}
