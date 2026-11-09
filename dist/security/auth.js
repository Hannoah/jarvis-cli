/**
 * OAuth 2.0 + API Key authentication (MS Copilot Studio compatible).
 * Port of auth.py with the same hardening:
 *  - access/refresh tokens are checked against an issued-token store (forged prefixes are rejected)
 *  - issued tokens are persisted as SHA-256 hashes
 *  - /oauth/register never returns the master API key
 *  - /oauth/authorize requires the API key on a consent page
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { readEnvFile } from "../core/config.js";
import { writeFileAtomic } from "../files/fsutil.js";
import { VERSION } from "../core/version.js";
import { setIdentity, syncIdentity } from "./identity.js";
export const DEFAULT_CLIENT_ID = "jarvis"; // never checked by the server: clients registered under the old "pc-mcp-client" keep working
const ACCESS_TOKEN_TTL = 365 * 86400; // 1 year: avoids daily disconnects
const REFRESH_TOKEN_TTL = 365 * 86400;
const AUTH_CODE_TTL = 600;
const MAX_BODY = 1024 * 1024;
export function maskSecret(value, visible = 6) {
    if (!value)
        return String(value);
    if (value.length <= visible)
        return "***";
    return `${value.slice(0, visible)}***(${value.length} chars)`;
}
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
/** Constant-time compare that does not leak length (both sides are hashed first). */
function safeEqual(a, b) {
    return crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());
}
const unquote = (s) => s.trim().replace(/^["']+|["']+$/g, "");
export function getOrCreateApiKey(cfg) {
    syncIdentity(cfg.envFile, cfg.home); // the PC's key wins over whatever this settings folder says
    const existing = (readEnvFile(cfg.envFile).PC_MCP_API_KEY ?? process.env.PC_MCP_API_KEY ?? "").trim();
    if (existing)
        return existing;
    const key = `pcmcp_${crypto.randomBytes(24).toString("base64url")}`;
    setIdentity(cfg.envFile, cfg.home, { apiKey: key }); // first creation only: from now on this is the PC's key
    return key;
}
/** Identifies the API key the tokens were issued under (not reversible to the key itself). */
const keyFingerprint = (key) => sha256(`jarvis-token-binding:${key}`).slice(0, 32);
class TokenStore {
    file;
    access = new Map();
    refresh = new Map();
    /** Fingerprint of the API key the tokens belong to; "" until bind() is called. */
    fp = "";
    /** Fingerprint recorded in the file we last read or wrote. */
    fileFp;
    loadedAt = 0;
    constructor(file) {
        this.file = file;
        this.load();
    }
    now = () => Date.now() / 1000;
    load() {
        this.loadedAt = Date.now();
        try {
            const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
            // tokens issued under another key are void (files from older versions have no fingerprint and are adopted)
            if (!(this.fp && data.keyFp !== undefined && data.keyFp !== this.fp)) {
                this.access = new Map(Object.entries(data.access ?? {}).map(([k, v]) => [k, Number(v)]));
                this.refresh = new Map(Object.entries(data.refresh ?? {}).map(([k, v]) => [k, Number(v)]));
                this.fileFp = data.keyFp;
            }
        }
        catch {
            /* missing or unreadable: keep what we have in memory */
        }
        this.purge();
    }
    /**
     * Tie the store to the current API key. Regenerating the key must also end every connection made with the old one,
     * so a different key revokes all issued tokens (the first call after startup only adopts the stored ones).
     */
    bind(fp) {
        if (fp === this.fp)
            return;
        const stale = this.fp ? true : this.fileFp !== undefined && this.fileFp !== fp;
        this.fp = fp;
        if (stale) {
            this.access.clear();
            this.refresh.clear();
        }
        if (stale || this.fileFp !== fp)
            this.save();
    }
    save() {
        try {
            writeFileAtomic(this.file, JSON.stringify({ keyFp: this.fp || undefined, access: Object.fromEntries(this.access), refresh: Object.fromEntries(this.refresh) }));
            this.fileFp = this.fp || undefined;
        }
        catch {
            /* persistence is best effort */
        }
    }
    purge() {
        const n = this.now();
        for (const m of [this.access, this.refresh])
            for (const [k, v] of m)
                if (v <= n)
                    m.delete(k);
    }
    issue() {
        this.purge();
        const access = `mcp_at_${crypto.randomBytes(32).toString("base64url")}`;
        const refresh = `mcp_rt_${crypto.randomBytes(32).toString("base64url")}`;
        const n = this.now();
        this.access.set(sha256(access), n + ACCESS_TOKEN_TTL);
        this.refresh.set(sha256(refresh), n + REFRESH_TOKEN_TTL);
        this.save();
        return { access, refresh };
    }
    isValidAccess(token) {
        const h = sha256(token);
        let exp = this.access.get(h);
        if (!exp && Date.now() - this.loadedAt > 2000) {
            this.load(); // another process may have issued it; throttled so unknown tokens cannot make every request hit the disk
            exp = this.access.get(h);
        }
        return !!exp && exp > this.now();
    }
    /** Validate and revoke (rotation). */
    consumeRefresh(token) {
        const h = sha256(token);
        const exp = this.refresh.get(h);
        if (exp === undefined)
            return false;
        this.refresh.delete(h);
        this.save();
        return exp > this.now();
    }
}
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
/** First value wins, like Python's parse_qs(...)[k][0]. */
function parseForm(body) {
    const out = {};
    for (const [k, v] of new URLSearchParams(body))
        if (!(k in out))
            out[k] = v;
    return out;
}
export async function readBody(req, max = MAX_BODY, timeoutMs = 30_000) {
    const chunks = [];
    let size = 0;
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            req.destroy();
            reject(new Error("request body timeout"));
        }, timeoutMs);
    });
    const readPromise = (async () => {
        try {
            for await (const c of req) {
                size += c.length;
                if (size > max) {
                    req.destroy();
                    throw new Error("body too large");
                }
                chunks.push(c);
            }
            return Buffer.concat(chunks).toString("utf8");
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    })();
    return Promise.race([readPromise, timeoutPromise]);
}
function sendJson(res, status, data, extra = {}) {
    const body = JSON.stringify(data);
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), "cache-control": "no-store", ...extra });
    res.end(body);
}
function sendHtml(res, status, html) {
    // No `form-action 'self'`: Chromium would block the 302 from POST /oauth/authorize to the external redirect_uri.
    res.writeHead(status, {
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(html),
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(html);
}
function consentPage(params, error = "") {
    let host = "(unknown)";
    try {
        host = new URL(params.redirect_uri ?? "").host || host;
    }
    catch {
        /* keep default */
    }
    const hidden = Object.entries(params)
        .filter(([k]) => k !== "api_key")
        .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
        .join("\n");
    const err = error ? `<p style="color:#c00">${escapeHtml(error)}</p>` : "";
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>Jarvis PC 접근 승인</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto">
<h2>Jarvis (PC-MCP) 접근 승인</h2>
<p>다음 앱이 이 PC의 파일/터미널 접근 권한을 요청합니다.</p>
<p><b>Redirect 대상:</b> ${escapeHtml(host)}</p>
<p>본인이 요청한 것이 맞다면 대시보드에 표시된 API Key(또는 설정 폴더(<code>~/.jarvis</code>)의 <code>.env</code>에 있는 <code>PC_MCP_API_KEY</code>)를 입력하세요.</p>
${err}
<form method="post" action="/oauth/authorize">
${hidden}
<input type="password" name="api_key" placeholder="PC_MCP_API_KEY" style="width:100%;padding:8px" autofocus required>
<button type="submit" style="margin-top:12px;padding:8px 16px">승인</button>
</form>
</body></html>`;
}
const METADATA_PATHS = new Set([
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/mcp",
    "/.well-known/openid-configuration",
    "/.well-known/openid-configuration/mcp",
]);
const RESOURCE_PATHS = new Set(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]);
export function createAuth(cfg, audit, apiKey, clientId = DEFAULT_CLIENT_ID) {
    const tokens = new TokenStore(cfg.tokenStoreFile);
    const codes = new Map();
    /**
     * The live API key. Re-read when .env actually changed (mtime/size), so a regenerated key takes
     * effect at once, but a steady-state request pays one stat instead of a read + full parse.
     */
    let keyCache = { mtimeMs: -1, size: -1, key: apiKey };
    const currentKey = () => {
        let mtimeMs = -1;
        let size = -1;
        try {
            const st = fs.statSync(cfg.envFile);
            mtimeMs = st.mtimeMs;
            size = st.size;
        }
        catch {
            /* deleted: (mtimeMs, size) stays (-1, -1) and matches a cached miss */
        }
        if (mtimeMs !== keyCache.mtimeMs || size !== keyCache.size) {
            if (syncIdentity(cfg.envFile, cfg.home).length)
                return currentKey(); // someone edited the key by hand: put the PC's back (rotate is the way to change it)
            keyCache = { mtimeMs, size, key: (readEnvFile(cfg.envFile).PC_MCP_API_KEY ?? "").trim() || apiKey };
        }
        return keyCache.key;
    };
    const secretOk = (value) => !!value && safeEqual(unquote(value), currentKey());
    const hdr = (req, name) => {
        const v = req.headers[name];
        return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
    };
    const baseUrl = (req) => {
        const proto = hdr(req, "x-forwarded-proto") || "http";
        const host = hdr(req, "x-forwarded-host") || hdr(req, "host") || `127.0.0.1:${cfg.port}`;
        return `${proto}://${host}`;
    };
    function extractToken(req, url) {
        const a = hdr(req, "authorization");
        if (a)
            return /^(bearer|apikey) /i.test(a) ? unquote(a.slice(a.indexOf(" ") + 1)) : unquote(a);
        for (const n of ["x-api-key", "api-key"]) {
            const v = hdr(req, n);
            if (v)
                return unquote(v);
        }
        for (const n of ["api_key", "token", "access_token"]) {
            const v = url.searchParams.get(n);
            if (v)
                return unquote(v);
        }
        return null;
    }
    async function authorize(req, res, url, method) {
        const params = Object.fromEntries(url.searchParams);
        if (method === "POST")
            Object.assign(params, parseForm(await readBody(req)));
        const redirectUri = params.redirect_uri;
        if (!redirectUri)
            return sendJson(res, 400, { error: "invalid_request", error_description: "Missing redirect_uri" });
        let target;
        try {
            target = new URL(redirectUri);
        }
        catch {
            return sendJson(res, 400, { error: "invalid_request", error_description: "Invalid redirect_uri" });
        }
        if (!["https:", "http:"].includes(target.protocol) || !target.host) {
            return sendJson(res, 400, { error: "invalid_request", error_description: "Invalid redirect_uri" });
        }
        if (method !== "POST")
            return sendHtml(res, 200, consentPage(params));
        if (!secretOk(params.api_key)) {
            console.log("[AUTH] /oauth/authorize rejected: invalid API key on consent form");
            return sendHtml(res, 401, consentPage(params, "API Key가 올바르지 않습니다."));
        }
        const code = `code_${crypto.randomBytes(32).toString("base64url")}`;
        const now = Date.now() / 1000;
        for (const [c, i] of codes)
            if (i.expiresAt <= now)
                codes.delete(c);
        codes.set(code, {
            expiresAt: now + AUTH_CODE_TTL,
            codeChallenge: params.code_challenge,
            codeChallengeMethod: params.code_challenge_method ?? "plain",
            redirectUri,
        });
        target.searchParams.set("code", code);
        if (params.state)
            target.searchParams.set("state", params.state);
        res.writeHead(302, { location: target.toString(), "cache-control": "no-store" });
        res.end();
    }
    async function token(req, res) {
        const raw = await readBody(req);
        let data = {};
        if ((hdr(req, "content-type")).includes("application/json")) {
            try {
                const j = JSON.parse(raw);
                if (j && typeof j === "object" && !Array.isArray(j))
                    data = j;
            }
            catch {
                /* empty */
            }
        }
        else
            data = parseForm(raw);
        let clientSecret = data.client_secret;
        const basic = hdr(req, "authorization");
        if (basic.toLowerCase().startsWith("basic ")) {
            const decoded = Buffer.from(basic.slice(6).trim(), "base64").toString("utf8");
            const i = decoded.indexOf(":");
            if (i >= 0)
                clientSecret = clientSecret ?? decoded.slice(i + 1);
        }
        const grant = data.grant_type ?? "authorization_code";
        const fail = (status, error, description) => sendJson(res, status, description ? { error, error_description: description } : { error });
        if (grant === "authorization_code") {
            const code = data.code ?? "";
            const info = codes.get(code);
            if (!info || info.expiresAt < Date.now() / 1000) {
                codes.delete(code);
                return fail(400, "invalid_grant", "Invalid or expired authorization code");
            }
            if (data.redirect_uri && data.redirect_uri !== info.redirectUri)
                return fail(400, "invalid_grant", "redirect_uri mismatch");
            // PKCE: if a challenge was registered, a matching verifier is mandatory.
            if (info.codeChallenge) {
                const verifier = data.code_verifier ?? "";
                if (!verifier)
                    return fail(400, "invalid_grant", "Missing code_verifier");
                const computed = info.codeChallengeMethod.toUpperCase() === "S256"
                    ? crypto.createHash("sha256").update(verifier, "ascii").digest("base64url")
                    : verifier;
                if (!safeEqual(computed, info.codeChallenge))
                    return fail(400, "invalid_grant", "PKCE verification failed");
            }
            else if (clientSecret !== undefined && !secretOk(clientSecret)) {
                return fail(401, "invalid_client", "Invalid client_secret");
            }
            codes.delete(code); // single use, only after validation succeeded
        }
        else if (grant === "client_credentials") {
            if (!secretOk(clientSecret))
                return fail(401, "invalid_client", "Invalid client_secret");
        }
        else if (grant === "refresh_token") {
            if (!tokens.consumeRefresh(data.refresh_token ?? ""))
                return fail(400, "invalid_grant", "Invalid or expired refresh_token");
        }
        else {
            return fail(400, "unsupported_grant_type");
        }
        const t = tokens.issue();
        audit("oauth", "TOKEN_ISSUED", `grant=${grant}`);
        sendJson(res, 200, {
            access_token: t.access,
            token_type: "Bearer",
            expires_in: ACCESS_TOKEN_TTL,
            refresh_token: t.refresh,
            scope: data.scope ?? "mcp:tools",
        });
    }
    return {
        async handle(req, res) {
            const method = (req.method ?? "GET").toUpperCase();
            const url = new URL(req.url ?? "/", "http://placeholder");
            const p = url.pathname;
            tokens.bind(keyFingerprint(currentKey()));
            if (p.startsWith("/oauth/") || p === "/mcp") {
                audit("http", "REQ", `${method} ${p} ua=${hdr(req, "user-agent").slice(0, 90) || "-"}`);
            }
            try {
                if (METADATA_PATHS.has(p)) {
                    const b = baseUrl(req);
                    sendJson(res, 200, {
                        issuer: b,
                        authorization_endpoint: `${b}/oauth/authorize`,
                        token_endpoint: `${b}/oauth/token`,
                        registration_endpoint: `${b}/oauth/register`,
                        response_types_supported: ["code"],
                        grant_types_supported: ["authorization_code", "client_credentials", "refresh_token"],
                        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
                        code_challenge_methods_supported: ["S256", "plain"],
                    });
                    return true;
                }
                if (RESOURCE_PATHS.has(p)) {
                    const b = baseUrl(req);
                    sendJson(res, 200, { resource: `${b}/mcp`, authorization_servers: [b], bearer_methods_supported: ["header"] });
                    return true;
                }
                if (p === "/oauth/authorize" && (method === "GET" || method === "POST")) {
                    await authorize(req, res, url, method);
                    return true;
                }
                if (p === "/oauth/token" && method === "POST") {
                    await token(req, res);
                    return true;
                }
                if (p === "/oauth/register" && method === "POST") {
                    let reqBody = {};
                    try {
                        reqBody = JSON.parse((await readBody(req)) || "{}");
                    }
                    catch {
                        /* ignore */
                    }
                    const uris = reqBody && typeof reqBody === "object" && Array.isArray(reqBody.redirect_uris)
                        ? reqBody.redirect_uris
                        : [];
                    // Public client: the master API key is NEVER returned here.
                    sendJson(res, 201, {
                        client_id: clientId,
                        redirect_uris: uris,
                        grant_types: ["authorization_code", "refresh_token"],
                        response_types: ["code"],
                        token_endpoint_auth_method: "none",
                    });
                    return true;
                }
                // Unauthenticated health probe (cloud gateways and the local ONBOARDING.html opened from file://).
                if ((p === "/" || p === "/health") && ["GET", "HEAD", "OPTIONS"].includes(method)) {
                    const cors = {
                        "access-control-allow-origin": "*",
                        "access-control-allow-methods": "GET, HEAD, OPTIONS",
                        "access-control-allow-headers": "*",
                    };
                    if (method === "OPTIONS") {
                        res.writeHead(204, cors);
                        res.end();
                    }
                    else {
                        // unauthenticated and reachable through the public tunnel: no folder names, no URLs
                        sendJson(res, 200, { name: "Jarvis", version: VERSION, status: "ok", mcp_endpoint: "/mcp" }, cors);
                    }
                    return true;
                }
            }
            catch (err) {
                console.error("auth route failed:", err);
                if (!res.headersSent)
                    sendJson(res, 400, { error: "invalid_request" });
                return true;
            }
            const tok = extractToken(req, url);
            if (!tok || !(secretOk(tok) || tokens.isValidAccess(tok))) {
                console.log(`[AUTH 401] Rejected ${method} ${p} (token=${maskSecret(tok)})`);
                audit("http", "AUTH_401", `${method} ${p} token_present=${!!tok}`);
                sendJson(res, 401, { error: "Unauthorized", message: "Invalid or missing OAuth 2.0 Bearer token or API Key." }, { "www-authenticate": `Bearer realm="PC-MCP", resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"` });
                return true;
            }
            return false;
        },
    };
}
