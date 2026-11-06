/**
 * SSRF-safe HTTP fetch + HTML -> Markdown.
 * The original checked the host once and then let urllib re-resolve and follow redirects, so a public URL could
 * redirect to 127.0.0.1 / cloud metadata, or rebind DNS between check and connect. Here every connection goes through
 * a `lookup` that validates the address it actually connects to, and redirects are followed manually (each hop checked).
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { VERSION } from "../core/version.js";
/** True for loopback, private, link-local, CGNAT, multicast, unspecified and IPv4-mapped equivalents. */
export function isBlockedIp(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split(".").map(Number);
        return (a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && ip.startsWith("192.0.0.")) || (a === 198 && (b === 18 || b === 19)));
    }
    if (net.isIPv6(ip)) {
        const l = ip.toLowerCase();
        const mapped = l.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped)
            return isBlockedIp(mapped[1]);
        return l === "::" || l === "::1" || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith("ff") || l.startsWith("64:ff9b:");
    }
    return true;
}
const safeLookup = (hostname, options, cb) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
        if (err)
            return cb(err, "", 4);
        const list = addrs;
        const bad = list.find((a) => isBlockedIp(a.address));
        if (bad || !list.length)
            return cb(new Error(`Private or internal network address (${bad?.address ?? "none"}) is blocked.`), "", 4);
        const first = list[0];
        if (options.all)
            return cb(null, list);
        cb(null, first.address, first.family);
    });
};
function validateUrl(raw) {
    let u;
    try {
        u = new URL(raw);
    }
    catch {
        throw new Error("URL resolution failed: invalid URL");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:")
        throw new Error("Only http:// and https:// URLs are allowed.");
    if (!u.hostname)
        throw new Error("Missing hostname in URL.");
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (["localhost", "0.0.0.0"].includes(host.toLowerCase()) || host.toLowerCase().endsWith(".localhost")) {
        throw new Error("Loopback / localhost URLs are blocked for security.");
    }
    if (net.isIP(host) && isBlockedIp(host))
        throw new Error(`Private or internal network address (${host}) is blocked.`);
    return u;
}
function once(u, headers, maxBytes, timeoutMs) {
    return new Promise((resolve, reject) => {
        const mod = u.protocol === "https:" ? https : http;
        const req = mod.request(u, { method: "GET", headers, lookup: safeLookup, timeout: timeoutMs }, (res) => {
            const chunks = [];
            let size = 0;
            res.on("data", (c) => {
                size += c.length;
                if (size > maxBytes) {
                    chunks.push(c.subarray(0, c.length - (size - maxBytes)));
                    res.destroy(); // enough: truncate at the cap
                    return;
                }
                chunks.push(c);
            });
            const done = () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
            res.on("end", done);
            res.on("close", done);
            res.on("error", () => done());
        });
        req.on("timeout", () => req.destroy(new Error("timed out")));
        req.on("error", reject);
        req.end();
    });
}
export async function safeFetch(rawUrl, opts = {}) {
    const { maxBytes = 2 * 1024 * 1024, timeoutMs = 15000, maxRedirects = 5 } = opts;
    const headers = { "user-agent": `Mozilla/5.0 (compatible; Jarvis-MCP/${VERSION})`, "accept-encoding": "identity", ...opts.headers };
    let u = validateUrl(rawUrl.trim());
    for (let hop = 0; hop <= maxRedirects; hop++) {
        const r = await once(u, headers, maxBytes, timeoutMs);
        if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
            u = validateUrl(new URL(String(r.headers.location), u).toString()); // re-validate every hop
            continue;
        }
        if (r.status >= 400)
            throw new Error(`HTTP ${r.status}`);
        return { finalUrl: u.toString(), contentType: String(r.headers["content-type"] ?? ""), body: r.body };
    }
    throw new Error("Too many redirects.");
}
// ---- HTML -> Markdown -------------------------------------------------------------------------
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", copy: "©" };
export function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === "#") {
            const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
        }
        return ENTITIES[e.toLowerCase()] ?? m;
    });
}
const SKIP = new Set(["script", "style", "noscript", "svg", "iframe"]);
export function htmlToMarkdown(html) {
    const src = html.replace(/<!--[\s\S]*?-->/g, "");
    const out = [];
    let title = "";
    let inTitle = false;
    let skip = 0;
    let pre = 0;
    const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|([^<]+|<)/g;
    for (let m; (m = re.exec(src));) {
        if (m[2] !== undefined) {
            if (skip)
                continue;
            const data = decodeEntities(m[2]);
            if (inTitle)
                title += data.trim();
            else {
                const cleaned = data.replace(/[ \t]+/g, " ");
                if (cleaned.trim())
                    out.push(cleaned);
            }
            continue;
        }
        const closing = m[0].startsWith("</");
        const t = m[1].toLowerCase();
        if (SKIP.has(t)) {
            if (closing)
                skip = Math.max(0, skip - 1);
            else if (!m[0].endsWith("/>"))
                skip++;
            continue;
        }
        if (skip)
            continue;
        if (t === "title")
            inTitle = !closing;
        else if (!closing) {
            if (/^h[1-4]$/.test(t))
                out.push(`\n\n${"#".repeat(Number(t[1]))} `);
            else if (["p", "div", "section", "article", "tr", "br"].includes(t))
                out.push("\n");
            else if (t === "li")
                out.push("\n- ");
            else if (t === "pre") {
                pre++;
                out.push("\n`");
            }
            else if (t === "code" && !pre)
                out.push("`");
        }
        else if (t === "pre") {
            pre = Math.max(0, pre - 1);
            out.push("`\n");
        }
        else if (t === "code") {
            if (!pre)
                out.push("`");
        }
        else if (/^h[1-4]$/.test(t) || t === "p")
            out.push("\n");
    }
    const markdown = out.join("").split(/\r?\n/).map((l) => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return { title, markdown };
}
/** Decode using the charset from Content-Type (falls back to UTF-8, replacing invalid bytes). */
export function decodeBody(body, contentType) {
    const cs = /charset=([^;\s]+)/i.exec(contentType)?.[1]?.replace(/["']/g, "") ?? "utf-8";
    try {
        return new TextDecoder(cs).decode(body);
    }
    catch {
        return new TextDecoder("utf-8").decode(body);
    }
}
