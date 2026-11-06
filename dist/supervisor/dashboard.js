/**
 * Local web dashboard. It can change the sandbox and restart the server, so it is locked down like a Jupyter server:
 *  - bound to loopback only, and never exposed through the tunnel (the tunnel only forwards the MCP port)
 *  - every request needs the secret token (header, or ?token= when loading the page)
 *  - Host must be this server (blocks DNS rebinding); Origin / Sec-Fetch-Site must be same-origin (blocks CSRF)
 *  - state-changing calls must be JSON (a plain cross-site <form> cannot send that)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../core/config.js";
import { portOwnerPid } from "../system/proc.js";
import { BrowseError, browse } from "./fsbrowse.js";
import { applySettings, readApiKey, regenerateApiKey, SettingsError, viewSettings } from "./settings.js";
import { listTools } from "./tools.js";
import { renderUi } from "./ui.js";
const LOG_FILES = {
    audit: ["audit.log"],
    server: ["server.err.log", "server.out.log"],
    tunnel: ["tunnel.log"],
    supervisor: ["supervisor.log"],
};
const eq = (a, b) => crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());
/** Last `lines` lines of a file without reading all of it. */
export function tailFile(file, lines, maxBytes = 256 * 1024) {
    try {
        const fd = fs.openSync(file, "r");
        try {
            const size = fs.fstatSync(fd).size;
            const len = Math.min(size, maxBytes);
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, size - len);
            const all = buf.toString("utf8").split(/\r?\n/);
            if (size > len)
                all.shift(); // first line is cut
            if (all[all.length - 1] === "")
                all.pop();
            return all.slice(-lines).join("\n");
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return "";
    }
}
const AUDIT_LINE = /^\[(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\] \[([A-Z_0-9]+)\] \[([^\]]*)\] ?(.*)$/;
/**
 * What the AI has been doing, from audit.log: calls per 2 minutes over the last hour plus the latest events.
 * Housekeeping lines (LOAD, REQ, SKIP_*) are noise here; refused work (BLOCKED_*, ERROR, AUTH_401) counts as "bad".
 */
export function readActivity(auditFile, now = Date.now(), windowMin = 60, bucketMin = 2) {
    const bucketMs = bucketMin * 60000;
    const n = Math.ceil(windowMin / bucketMin);
    const start = now - n * bucketMs;
    const buckets = Array.from({ length: n }, (_, i) => ({ t: start + i * bucketMs, ok: 0, bad: 0 }));
    const totals = { ok: 0, bad: 0 };
    const events = [];
    for (const line of tailFile(auditFile, 4000, 512 * 1024).split("\n")) {
        const m = AUDIT_LINE.exec(line);
        if (!m)
            continue;
        const status = m[7];
        const kind = status === "ALLOW" || status === "TOKEN_ISSUED" ? "ok" : status.startsWith("BLOCKED") || status === "ERROR" || status === "AUTH_401" ? "bad" : null;
        if (!kind)
            continue;
        const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
        events.push({ t, status, tool: m[8], detail: m[9].slice(0, 160) });
        const i = Math.floor((t - start) / bucketMs);
        if (i >= 0 && i < n) {
            buckets[i][kind]++;
            totals[kind]++;
        }
    }
    events.sort((a, b) => a.t - b.t); // rotated or hand-edited logs are not guaranteed to be in order
    return { window_minutes: n * bucketMin, bucket_minutes: bucketMin, buckets, totals, recent: events.slice(-12).reverse() };
}
/** Name of the process holding a TCP port, or null. Slow (spawns netstat/tasklist): callers cache. */
export function portOwner(port) {
    const pid = portOwnerPid(port);
    if (!pid)
        return null;
    let name = "";
    try {
        if (process.platform === "win32") {
            const r = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
            name = /^"([^"]+)"/.exec(r.stdout ?? "")?.[1] ?? "";
        }
        else {
            name = spawnSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", timeout: 5000 }).stdout.trim();
        }
    }
    catch {
        /* name stays empty */
    }
    return { pid, name };
}
export function diagnoseServer(o) {
    if (o.status.state !== "failed" && o.status.state !== "restarting")
        return [];
    const errLog = path.join(o.projectDir, "server.err.log");
    let fresh = false;
    try {
        // the log survives restarts of the supervisor: only trust it if it was written around the last exit
        fresh = fs.statSync(errLog).mtimeMs >= (o.status.last_exit?.at ?? 0) - 15000;
    }
    catch {
        return [];
    }
    if (!fresh || !/EADDRINUSE/.test(tailFile(errLog, 40)))
        return [];
    const who = (o.ownerOf ?? portOwner)(o.port);
    const by = who ? `${who.name || "?§Î•∏ ?ÑÎ°úÍ∑∏Îû®"}(PID ${who.pid})` : "?§Î•∏ ?ÑÎ°úÍ∑∏Îû®";
    return [
        {
            summary: `${o.port} ?¨Ìä∏Î•?${by}??Í∞Ä) ?¨Ïö© Ï§ëÏûÖ?àÎã§.`,
            fix: `Í∑??ÑÎ°úÍ∑∏Îû®??Ï¢ÖÎ£å?????òÎã§???úÏûë?ôÏùÑ ?ÑÎ•¥Í±∞ÎÇò, data/.env??PC_MCP_PORTÎ•??§Î•∏ Î≤àÌò∏Î°?Î∞îÍæ∏?∏Ïöî. ?åÏù¥??Î≤ÑÏ†Ñ JarvisÍ∞Ä ÏºúÏ†∏ ?àÏúºÎ©?Í∞ôÏ? ?¨Ìä∏Î•??ÅÎãà??`,
        },
    ];
}
const SESSION_COOKIE = "jarvis_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_SESSIONS = 20;
export function createDashboard(d) {
    // Browser sessions. The long token in the URL is exchanged once for a random session id (HttpOnly, SameSite=Strict), so the
    // address bar, history and bookmarks never keep the real secret and the plain address works afterwards. In memory on purpose:
    // restarting Jarvis signs every browser out.
    const sessions = new Map();
    const cookieOf = (req) => {
        for (const part of String(req.headers.cookie ?? "").split(";")) {
            const [k, ...v] = part.trim().split("=");
            if (k === SESSION_COOKIE)
                return v.join("=");
        }
        return "";
    };
    const validSession = (id) => {
        const exp = id ? sessions.get(id) : undefined;
        if (exp === undefined)
            return false;
        if (exp < Date.now())
            return sessions.delete(id), false;
        return true;
    };
    const newSession = () => {
        const id = crypto.randomBytes(24).toString("base64url");
        sessions.set(id, Date.now() + SESSION_TTL_MS);
        while (sessions.size > MAX_SESSIONS)
            sessions.delete(sessions.keys().next().value);
        return id;
    };
    const hosts = new Set([`127.0.0.1:${d.port}`, `localhost:${d.port}`, `[::1]:${d.port}`]);
    const origins = new Set([...hosts].map((h) => `http://${h}`));
    const securityHeaders = {
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
    };
    const send = (res, status, body, type = "application/json; charset=utf-8", extra = {}) => {
        res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body), ...securityHeaders, ...extra });
        res.end(body);
    };
    const json = (res, status, v) => send(res, status, JSON.stringify(v));
    async function readJson(req) {
        if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? "")))
            throw Object.assign(new Error("Content-Type must be application/json"), { status: 415 });
        const chunks = [];
        let n = 0;
        for await (const c of req) {
            n += c.length;
            if (n > 64 * 1024)
                throw Object.assign(new Error("body too large"), { status: 413 });
            chunks.push(c);
        }
        const text = Buffer.concat(chunks).toString("utf8");
        const v = text ? JSON.parse(text) : {};
        return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    }
    const cfgNow = () => loadConfig({ projectDir: d.projectDir });
    let hintCache = { at: 0, key: "", v: [] };
    // The page never changes for a running dashboard (the version is fixed), so render once.
    let pageCache = { version: "", html: "" };
    const page = () => {
        if (pageCache.version !== d.version)
            pageCache = { version: d.version, html: renderUi(d.version) };
        return pageCache.html;
    };
    // The activity feed re-reads and re-parses up to 512 KB of audit.log; redo it only when the file grew.
    let activityCache = { mtimeMs: -1, size: -1, v: null };
    function activity() {
        const f = path.join(d.projectDir, "audit.log");
        let mtimeMs = -1;
        let size = -1;
        try {
            const st = fs.statSync(f);
            mtimeMs = st.mtimeMs;
            size = st.size;
        }
        catch {
            /* missing: (-1, -1) matches a cached miss */
        }
        if (!activityCache.v || activityCache.mtimeMs !== mtimeMs || activityCache.size !== size) {
            const v = readActivity(f);
            activityCache = { mtimeMs, size, v };
            return v;
        }
        return activityCache.v;
    }
    // The tool list is a full MCP round-trip (the engine builds a 40-tool server to answer it).
    // Tools only change when the engine restarts or a plugin is added, so cache by engine start + TTL. Errors are never cached.
    let toolsCache = { at: 0, startedAt: null, tools: null };
    async function tools(port, apiKey) {
        const startedAt = d.server.status().started_at;
        if (!toolsCache.tools || toolsCache.startedAt !== startedAt || Date.now() - toolsCache.at > 30_000) {
            const fresh = await listTools(port, apiKey);
            toolsCache = { at: Date.now(), startedAt, tools: fresh };
            return fresh;
        }
        return toolsCache.tools;
    }
    function state(cfg = loadConfig({ projectDir: d.projectDir })) {
        const t = d.tunnel.snapshot();
        const status = d.server.status();
        // diagnosing shells out (netstat), so reuse the answer for a few seconds while the state is unchanged
        const key = `${status.state}|${status.total_restarts}|${cfg.port}`;
        if (key !== hintCache.key || Date.now() - hintCache.at > 10000)
            hintCache = { at: Date.now(), key, v: diagnoseServer({ projectDir: d.projectDir, port: cfg.port, status }) };
        return {
            version: d.version,
            server: status,
            hints: hintCache.v,
            tunnel: t,
            urls: { local: `http://127.0.0.1:${cfg.port}/mcp`, public: t.url || cfg.publicUrl },
            settings: viewSettings(d.projectDir, cfg),
        };
    }
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? "/", "http://placeholder");
            const method = (req.method ?? "GET").toUpperCase();
            // 1. DNS rebinding: a rebound attacker origin arrives with a foreign Host header
            if (!hosts.has(String(req.headers.host ?? "").toLowerCase()))
                return send(res, 403, "Forbidden host", "text/plain");
            // 2. CSRF: browsers always attach these on cross-site requests
            const origin = req.headers.origin;
            if (origin !== undefined && !origins.has(String(origin)))
                return send(res, 403, "Forbidden origin", "text/plain");
            const site = req.headers["sec-fetch-site"];
            if (site !== undefined && site !== "same-origin" && site !== "none")
                return send(res, 403, "Forbidden", "text/plain");
            // 3. who is asking: the secret token (scripts), or a browser session created by opening the token URL once
            const viaUrl = method === "GET" && url.pathname === "/" ? url.searchParams.get("token") ?? "" : "";
            if (viaUrl && eq(viaUrl, d.token)) {
                res.writeHead(302, { location: "/", "set-cookie": `${SESSION_COOKIE}=${newSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`, ...securityHeaders });
                return void res.end();
            }
            const header = String(req.headers["x-jarvis-token"] ?? "");
            if (!(header && eq(header, d.token)) && !validSession(cookieOf(req))) {
                if (method === "GET" && url.pathname === "/") {
                    // a person opened the bare address: say what to do instead of a bare 401
                    return send(res, 401, "<!doctype html><meta charset=utf-8><title>Jarvis</title><body style=\"font:16px/1.7 system-ui,'Malgun Gothic',sans-serif;max-width:520px;margin:15vh auto;padding:0 20px\"><h2>??Î∏åÎùº?∞Ï????ÑÏßÅ Î°úÍ∑∏?∏ÎêòÏßÄ ?äÏïò?µÎãà??/h2><p>Î≥¥Ïïà???ÑÌï¥ Ï≤òÏùå ??Î≤àÏ? JarvisÍ∞Ä ?¥Ïñ¥Ï£ºÎäî Ï£ºÏÜåÎ°??§Ïñ¥?Ä???©Îãà?? Í∑??§Ïóê????Ï£ºÏÜåÎß??¥Ïñ¥???©Îãà??</p><p><b>Jarvis.cmd</b>(Îß•Ï? Jarvis.command)Î•??îÎ∏î?¥Î¶≠?òÏÑ∏??</p>", "text/html; charset=utf-8");
                }
                return send(res, 401, "Open the dashboard URL printed by Jarvis (it contains ?token=...).", "text/plain");
            }
            if (method === "GET" && url.pathname === "/") {
                return send(res, 200, page(), "text/html; charset=utf-8", {
                    "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src https://cdn.jsdelivr.net; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
                });
            }
            if (!url.pathname.startsWith("/api/"))
                return send(res, 404, "Not found", "text/plain");
            if (method === "GET") {
                if (url.pathname === "/api/state")
                    return json(res, 200, state());
                if (url.pathname === "/api/fs")
                    return json(res, 200, browse(url.searchParams.get("path") ?? "", cfgNow().home));
                if (url.pathname === "/api/activity")
                    return json(res, 200, activity());
                if (url.pathname === "/api/tools") {
                    const c = cfgNow();
                    return json(res, 200, { tools: await tools(c.port, readApiKey(c)) });
                }
                if (url.pathname === "/api/logs") {
                    const kind = url.searchParams.get("kind") ?? "audit";
                    const files = LOG_FILES[kind];
                    if (!files)
                        return json(res, 400, { error: "unknown log" });
                    const n = Math.max(1, Math.min(Number(url.searchParams.get("lines")) || 200, 1000));
                    const text = files.map((f) => tailFile(path.join(d.projectDir, f), n)).filter(Boolean).join("\n--- next file ---\n");
                    return json(res, 200, { kind, text });
                }
                return json(res, 404, { error: "not found" });
            }
            if (method !== "POST")
                return json(res, 405, { error: "method not allowed" });
            const body = await readJson(req);
            switch (url.pathname) {
                case "/api/server/start":
                    await d.server.start();
                    return json(res, 200, state());
                case "/api/server/stop":
                    await d.server.stop();
                    return json(res, 200, state());
                case "/api/server/restart":
                    await d.server.restart();
                    return json(res, 200, state());
                case "/api/tunnel/start":
                    void d.tunnel.ensure().catch((e) => d.log(`[tunnel] ${e}`));
                    return json(res, 202, state());
                case "/api/tunnel/stop":
                    await d.tunnel.stop();
                    return json(res, 200, state());
                case "/api/settings": {
                    const changed = applySettings(d.projectDir, body);
                    d.log(`settings changed: ${changed.join(", ")}`);
                    return json(res, 200, { changed, restart_required: true, ...state() });
                }
                case "/api/apikey/reveal":
                    return json(res, 200, { api_key: readApiKey(cfgNow()) });
                case "/api/apikey/regenerate": {
                    const key = regenerateApiKey(cfgNow());
                    d.log("api key regenerated");
                    return json(res, 200, { api_key: key });
                }
                default:
                    return json(res, 404, { error: "not found" });
            }
        }
        catch (e) {
            const status = e instanceof SettingsError || e instanceof BrowseError ? 400 : e instanceof SyntaxError ? 400 : (e.status ?? 500);
            if (status === 500)
                d.log(`dashboard error: ${e.stack ?? e}`);
            if (!res.headersSent)
                json(res, status, { error: status === 500 ? "internal error" : e.message });
        }
    });
    server.headersTimeout = 30_000;
    return server;
}
