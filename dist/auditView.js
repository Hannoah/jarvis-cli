// `jarvis audit` (read the audit log) and `jarvis agents` (who uses the MCP server and the CLI). Reads audit.log directly: no server needed.
import fs from "node:fs";
import { c, truncate } from "./cliutil.js";
const LINE = /^\[(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\] \[([^\]]*)\] \[([^\]]*)\] (.*)$/;
export function parseAudit(text) {
    const out = [];
    for (const l of text.split(/\r?\n/)) {
        const m = LINE.exec(l);
        if (m)
            out.push({ time: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), status: m[7], tool: m[8], detail: m[9] });
    }
    return out;
}
/** 30m, 2h, 7d -> milliseconds. */
export function parseDuration(s) {
    const m = /^(\d+)\s*([mhd])$/i.exec(s.trim());
    return m ? +m[1] * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2].toLowerCase()] : null;
}
/** `key=value` / `key="quoted value"` pairs of an AGENT line. */
export function fields(detail) {
    const out = {};
    for (const m of detail.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g)) {
        let v = m[2];
        if (v.startsWith('"')) {
            try {
                v = JSON.parse(v);
            }
            catch {
                /* keep the raw text */
            }
        }
        out[m[1]] = v;
    }
    return out;
}
const tailOf = (file, max) => {
    try {
        const fd = fs.openSync(file, "r");
        try {
            const size = fs.fstatSync(fd).size;
            const len = Math.min(size, max);
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, size - len);
            return buf.toString("utf8");
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return "";
    }
};
/** The previous (rotated) log and the current one, oldest first. */
export const readEntries = (cfg, maxBytes = 8 * 1024 * 1024) => [...parseAudit(tailOf(`${cfg.auditLogFile}.1`, maxBytes)), ...parseAudit(tailOf(cfg.auditLogFile, maxBytes))];
const ago = (ms) => (ms < 90_000 ? "just now" : ms < 5_400_000 ? `${Math.round(ms / 60_000)}m ago` : ms < 129_600_000 ? `${Math.round(ms / 3_600_000)}h ago` : `${Math.round(ms / 86_400_000)}d ago`);
function opts(args) {
    return { flags: new Set(args), val: (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; } };
}
const statusColor = (s) => (/^BLOCKED|ERROR|AUTH_401|RATE/.test(s) ? c.red : s === "ALLOW" ? c.green : s === "AGENT" ? c.cyan : c.gray);
export function auditCommand(cfg, args, now = Date.now()) {
    const { flags, val } = opts(args);
    const n = Number(val("-n") ?? val("--limit") ?? 30) || 30;
    const since = val("--since");
    const span = since ? parseDuration(since) : null;
    if (since && span === null)
        return console.error(c.red("✖ --since takes a number and m, h or d: 30m, 2h, 7d")), 2;
    const tool = val("--tool")?.toLowerCase();
    const status = val("--status")?.toUpperCase();
    const agent = val("--agent")?.toLowerCase();
    let rows = readEntries(cfg).filter((e) => (!span || e.time.getTime() >= now - span) &&
        (!tool || e.tool.toLowerCase() === tool || fields(e.detail).tool?.toLowerCase() === tool) &&
        (!status || e.status.toUpperCase().includes(status)) &&
        (!agent || (fields(e.detail).agent ?? "").toLowerCase().includes(agent)));
    rows = rows.slice(-n);
    if (flags.has("--json"))
        return console.log(JSON.stringify(rows.map((e) => ({ time: e.time.toISOString(), status: e.status, tool: e.tool, detail: e.detail })))), 0;
    if (!rows.length)
        return console.log(c.dim(`No audit entries${since || tool || status || agent ? " match" : ""}. (${cfg.auditLogFile})`)), 0;
    const stamp = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${d.toTimeString().slice(0, 8)}`;
    const w = Math.max(...rows.map((e) => e.status.length));
    const cols = (process.stdout.columns ?? 120) - 1;
    for (const e of rows) {
        const detail = flags.has("--full") ? e.detail : truncate(e.detail, Math.max(20, cols - 17 - w - e.tool.length));
        console.log(`${c.gray(stamp(e.time))} ${statusColor(e.status)(e.status.padEnd(w))} ${c.bold(e.tool)} ${c.gray(detail)}`);
    }
    console.log(c.gray(`\n${rows.length} entr${rows.length === 1 ? "y" : "ies"} · --tool x · --status BLOCKED · --agent x · --since 2h · -n 100 · --json`));
    return 0;
}
/** One row per agent: the client name it announced, else its user-agent, else the CLI. */
export function summarizeAgents(entries, since = 0) {
    const rows = new Map();
    for (const e of entries) {
        if (e.status !== "AGENT" || e.time.getTime() < since)
            continue;
        const f = fields(e.detail);
        const name = f.agent || f.ua || (f.via === "cli" ? "(cli)" : "(unknown)");
        let r = rows.get(name);
        if (!r)
            rows.set(name, (r = { agent: name, version: "", via: [], connects: 0, calls: 0, tools: {}, first: e.time, last: e.time }));
        if (f.ver)
            r.version = f.ver;
        if (f.via && !r.via.includes(f.via))
            r.via.push(f.via);
        if (f.rpc === "initialize")
            r.connects++;
        if (f.rpc === "tools/call") {
            r.calls++;
            if (f.tool)
                r.tools[f.tool] = (r.tools[f.tool] ?? 0) + 1;
        }
        r.last = e.time;
    }
    return [...rows.values()].sort((a, b) => b.last.getTime() - a.last.getTime());
}
export function agentsCommand(cfg, args, now = Date.now()) {
    const { flags, val } = opts(args);
    const spanText = val("--since") ?? "7d";
    const span = parseDuration(spanText);
    if (span === null)
        return console.error(c.red("✖ --since takes a number and m, h or d: 30m, 2h, 7d")), 2;
    const rows = summarizeAgents(readEntries(cfg), now - span);
    if (flags.has("--json"))
        return console.log(JSON.stringify(rows.map((r) => ({ ...r, first: r.first.toISOString(), last: r.last.toISOString() })))), 0;
    if (!rows.length) {
        console.log(c.dim(`No agent has used Jarvis in the last ${spanText}.`));
        console.log(c.dim("  An agent shows up here once it connects to the MCP server, or runs jarvis with JARVIS_AGENT=<name> set (Claude Code is detected automatically)."));
        return 0;
    }
    const label = (r) => (r.version ? `${r.agent} ${r.version}` : r.agent).slice(0, 40);
    const top = (r) => Object.entries(r.tools).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, k]) => `${t} ×${k}`).join(", ");
    const w = Math.max(5, ...rows.map((r) => label(r).length));
    const wv = Math.max(3, ...rows.map((r) => r.via.join("+").length));
    console.log(c.bold(`${"AGENT".padEnd(w)}  ${"VIA".padEnd(wv)}  ${"CALLS".padStart(5)}  ${"LAST SEEN".padEnd(9)}  TOP TOOLS`));
    for (const r of rows)
        console.log(`${c.accent(label(r).padEnd(w))}  ${r.via.join("+").padEnd(wv)}  ${String(r.calls).padStart(5)}  ${ago(now - r.last.getTime()).padEnd(9)}  ${c.gray(top(r))}`);
    console.log(c.gray(`\nlast ${spanText} · who ran what: jarvis audit --agent <name> · --since 30m · --json`));
    return 0;
}
