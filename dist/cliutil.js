// Pure CLI helpers: colors, argument parsing, result rendering. No Jarvis imports, so they are unit-testable.
export const isTTY = !!process.stdout.isTTY;
const colorOn = !process.env.NO_COLOR && (!!process.env.FORCE_COLOR || isTTY);
// 24-bit color where it is known to work (Windows Terminal, VS Code, COLORTERM), 256-color otherwise
const trueColor = /truecolor|24bit/i.test(process.env.COLORTERM ?? "") || !!process.env.WT_SESSION || process.env.TERM_PROGRAM === "vscode";
const esc = (code, s) => (colorOn ? `\x1b[${code}m${s}\x1b[0m` : s);
const sgr = (n) => (s) => esc(String(n), s);
/** a→b is the logo gradient, a is the accent colour, p256 is the nearest xterm-256 colour for terminals without 24-bit. */
export const THEMES = {
    blue: { a: [110, 168, 254], b: [167, 139, 250], p256: 75 },
    violet: { a: [167, 139, 250], b: [244, 114, 182], p256: 141 },
    emerald: { a: [52, 211, 153], b: [56, 189, 248], p256: 42 },
    amber: { a: [251, 191, 36], b: [248, 113, 113], p256: 214 },
    rose: { a: [251, 113, 133], b: [192, 132, 252], p256: 211 },
    mono: { a: [210, 210, 210], b: [140, 140, 140], p256: 250 },
};
export const themeNames = Object.keys(THEMES);
let theme = "blue";
export const currentTheme = () => theme;
export function setTheme(name) {
    if (!(name in THEMES))
        return false;
    theme = name;
    return true;
}
const fg = (t) => (trueColor ? `38;2;${THEMES[t].a.join(";")}` : `38;5;${THEMES[t].p256}`);
const lerp = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(";");
export const c = {
    bold: sgr(1), dim: sgr(2), red: sgr(31), green: sgr(32), yellow: sgr(33), cyan: sgr(36), gray: sgr(90),
    accent: (s) => esc(fg(theme), s),
    /** selected menu row: subtle background + bold accent */
    hl: (s) => esc(`48;5;237;1;${fg(theme)}`, s),
};
/** Colour a (multi-line) block with the theme gradient from left to right; plain accent where 24-bit colour is unavailable. */
export function gradient(text, name = theme) {
    if (!colorOn)
        return text;
    const width = Math.max(1, ...text.split("\n").map((l) => l.length - 1));
    return text
        .split("\n")
        .map((line) => trueColor
        ? [...line].map((ch, i) => (ch === " " ? ch : `\x1b[38;2;${lerp(THEMES[name].a, THEMES[name].b, i / width)}m${ch}`)).join("") + "\x1b[0m"
        : `\x1b[${fg(name)}m${line}\x1b[0m`)
        .join("\n");
}
/** Two gradient blocks showing what a theme looks like, for the picker. */
export const themeSwatch = (name) => gradient("████", name);
/** 1536 -> "1.5 KB". */
export function humanBytes(n) {
    if (typeof n !== "number")
        return "-";
    if (n < 1024)
        return `${n} B`;
    const u = ["KB", "MB", "GB", "TB"];
    let v = n / 1024, i = 0;
    while (v >= 1024 && i < u.length - 1)
        (v /= 1024, i++);
    return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}
export const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
/** Display width in terminal columns, counting East Asian fullwidth / CJK characters as 2 columns. */
export function stringWidth(s) {
    const clean = stripAnsi(s);
    let w = 0;
    for (let i = 0; i < clean.length; i++) {
        const cp = clean.codePointAt(i);
        if (cp > 0xffff)
            i++;
        if ((cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
            (cp >= 0x2e80 && cp <= 0x9fff) || // CJK Radicals, Ideographs, etc.
            (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
            (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
            (cp >= 0xfe10 && cp <= 0xfe19) || // Vertical forms
            (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK Compatibility Forms
            (cp >= 0xff01 && cp <= 0xff60) || // Fullwidth Forms
            (cp >= 0xffe0 && cp <= 0xffe6) ||
            (cp >= 0x20000 && cp <= 0x3fffd)) {
            w += 2;
        }
        else {
            w += 1;
        }
    }
    return w;
}
export const visibleLength = (s) => stringWidth(s);
const typeOf = (p) => [p?.type ?? "string"].flat();
export function coerce(v, p) {
    const t = typeOf(p);
    if (t.includes("string"))
        return v;
    if (t.includes("number") || t.includes("integer"))
        return Number.isNaN(Number(v)) ? v : Number(v);
    if (t.includes("boolean"))
        return v !== "false";
    try {
        return JSON.parse(v);
    }
    catch {
        return v;
    }
}
/**
 * `--key value`, `--key=value`, bare `--flag` (true), `--json '{...}'`, and positionals that fill the
 * required params first, then the optional ones in schema order: `read_file notes.txt 1 20`.
 */
export function parseArgs(argv, schema) {
    const props = schema.properties ?? {};
    const order = [...(schema.required ?? []), ...Object.keys(props).filter((k) => !schema.required?.includes(k))];
    let args = {};
    let help = false;
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        if (tok === "--help" || tok === "-h") {
            help = true;
            continue;
        }
        const m = /^--([^=]+)(?:=(.*))?$/.exec(tok);
        if (!m) {
            positional.push(tok);
            continue;
        }
        const key = m[1].replace(/-/g, "_");
        const next = argv[i + 1];
        // a boolean flag only swallows an explicit true/false, so `--recursive src` keeps `src` positional
        const takesNext = next !== undefined && !next.startsWith("--") && (!typeOf(props[key]).includes("boolean") || /^(true|false)$/.test(next));
        const raw = m[2] ?? (takesNext ? argv[++i] : undefined);
        if (key === "json")
            args = { ...JSON.parse(raw ?? "{}"), ...args };
        else if (!(key in props))
            throw new Error(`Unknown argument --${key}. See: jarvis help <tool>`);
        else
            args[key] = raw === undefined ? true : coerce(raw, props[key]);
    }
    for (const v of positional) {
        const key = order.find((k) => args[k] === undefined);
        if (!key)
            throw new Error(`Unexpected argument '${v}'. See: jarvis help <tool>`);
        args[key] = coerce(v, props[key]);
    }
    return { args, help };
}
/** Split a shell-ish line into tokens, honouring '…' and "…" (no escapes, so Windows paths survive). */
export const tokenize = (s) => (s.match(/(?:"[^"]*"|'[^']*'|\S)+/g) ?? []).map((t) => t.replace(/"([^"]*)"|'([^']*)'/g, (_, a, b) => a ?? b));
const lev = (a, b) => {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const next = [i];
        for (let j = 1; j <= b.length; j++)
            next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        row = next;
    }
    return row[b.length];
};
/** "Did you mean": names containing the input, else the closest by edit distance. */
export function suggest(name, names) {
    const n = name.toLowerCase().replace(/-/g, "_");
    const sub = names.filter((x) => x.includes(n));
    if (sub.length)
        return sub.slice(0, 3);
    return names.map((x) => [lev(n, x), x]).filter(([d]) => d <= 3).sort((a, b) => a[0] - b[0]).slice(0, 3).map(([, x]) => x);
}
export const truncate = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s);
const scalar = (v) => v === null || typeof v !== "object";
const cell = (v) => (v == null ? "-" : typeof v === "object" ? JSON.stringify(v) : String(v));
const isRows = (v) => Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === "object" && !Array.isArray(r) && Object.values(r).every(scalar));
/** Render rows as an aligned table; respects CJK double-width characters so columns align cleanly. */
export function table(rows, maxCell = 60, style) {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const body = rows.map((r) => cols.map((k) => truncate(cell(r[k]), maxCell)));
    const w = cols.map((k, i) => Math.max(stringWidth(k), ...body.map((r) => stringWidth(r[i]))));
    const padCell = (s, i) => {
        if (i === cols.length - 1)
            return s; // the last column is never padded
        const diff = w[i] - stringWidth(s);
        return diff > 0 ? s + " ".repeat(diff) : s;
    };
    const head = cols.map((k, i) => c.bold(padCell(k, i))).join("  ");
    const lines = body.map((r, ri) => r.map((s, i) => (style ? style(cols[i], padCell(s, i), rows[ri]) : padCell(s, i))).join("  "));
    return [head, ...lines].join("\n");
}
const pretty = (v) => JSON.stringify(v, null, 2).replace(/^(\s*)"([^"]+)":/gm, (_, sp, k) => `${sp}${c.cyan(`"${k}"`)}:`);
/** Human view of a tool's text result: file content as-is, row lists as a table, anything else indented JSON. */
export function render(text) {
    let v;
    try {
        v = JSON.parse(text);
    }
    catch {
        return text;
    }
    if (!v || typeof v !== "object" || Array.isArray(v))
        return pretty(v);
    const o = v;
    const meta = (skip) => Object.entries(o).filter(([k, x]) => !skip.includes(k) && scalar(x)).map(([k, x]) => `${k}=${cell(x)}`).join("  ");
    const rest = (skip) => Object.entries(o).every(([k, x]) => skip.includes(k) || scalar(x));
    const head = (skip) => (meta(skip) ? c.dim(meta(skip)) + "\n" : "");
    if (typeof o.stdout === "string" && typeof o.stderr === "string" && rest(["stdout", "stderr"])) {
        const out = [o.stdout.trimEnd(), o.stderr.trimEnd() && c.red(o.stderr.trimEnd())].filter(Boolean).join("\n");
        return head(["stdout", "stderr"]) + out;
    }
    if (typeof o.content === "string" && rest(["content"]))
        return head(["content"]) + o.content;
    const rowsKey = Object.keys(o).find((k) => isRows(o[k]));
    if (rowsKey && rest([rowsKey])) {
        // readable sizes, folders in the accent colour, quiet type/date columns
        const rows = o[rowsKey].map((r) => (!("size_bytes" in r) ? r : Object.fromEntries(Object.entries(r).map(([k, x]) => (k === "size_bytes" ? ["size", humanBytes(x)] : [k, x])))));
        return head([rowsKey]) + table(rows, 60, (k, text, r) => (k === "path" && r.type === "dir" ? c.accent(text) : k === "type" || k === "modified" ? c.gray(text) : text));
    }
    return pretty(v);
}
/** Tools report failures as {"error": "..."} text; pull the message out (and what else came with it). */
export function errorOf(text) {
    try {
        const o = JSON.parse(text);
        if (!o || typeof o.error !== "string")
            return null;
        const { error, success, ...extra } = o;
        return { message: error, extra: Object.keys(extra).length ? pretty(extra) : undefined };
    }
    catch {
        return null;
    }
}
/** Process-style results ({exit_code: 3, ...}) fail the CLI too. */
export const exitCodeOf = (text) => {
    try {
        const n = JSON.parse(text).exit_code;
        return typeof n === "number" ? n : 0;
    }
    catch {
        return 0;
    }
};
export function usage(name, schema) {
    const props = schema.properties ?? {};
    const req = schema.required ?? [];
    const parts = [
        ...req.map((k) => `<${k}>`),
        ...Object.entries(props).filter(([k]) => !req.includes(k)).map(([k, p]) => `[--${k} <${typeOf(p).join("|")}>]`),
    ];
    return `jarvis ${name} ${parts.join(" ")}`.trimEnd();
}
export function toolHelp(t) {
    const schema = t.inputSchema;
    const props = Object.entries(schema.properties ?? {});
    const rows = props.map(([k, p]) => ({
        param: `--${k}`,
        type: typeOf(p).join("|") + (p.enum ? ` (${p.enum.join("|")})` : ""),
        "": schema.required?.includes(k) ? "required" : "",
        description: (p.description ?? "").split("\n")[0],
    }));
    return [
        c.bold(t.name),
        t.description ?? "",
        "",
        `${c.dim("Usage:")} ${usage(t.name, schema)}`,
        ...(rows.length ? ["", table(rows, 90)] : []),
    ].join("\n");
}
export const propType = (p) => typeOf(p).join("|") + (p?.enum ? ` (${p.enum.join("|")})` : "");
// ponytail: static grouping for the menu; tools not listed here (e.g. plugins) land under "Other"
const CATEGORIES = {
    Environment: ["get_pc_env", "get_system_status"],
    Files: ["read_file", "write_file", "edit_file", "list_files", "search_in_files", "share_file_url", "read_document", "list_code_symbols"],
    Backups: ["undo_last_edit", "list_file_backups", "restore_file_backup"],
    Terminal: ["run_terminal", "start_background_job", "read_job_output", "stop_job", "list_background_jobs"],
    Git: ["git_status", "git_diff", "git_log", "git_commit"],
    Web: ["search_web", "fetch_web_page"],
    Wiki: ["wiki_index", "wiki_search", "wiki_read", "wiki_append", "wiki_create"],
    Desktop: ["open_in_default_app", "manage_clipboard", "send_notification"],
    Scheduler: ["schedule_task", "list_scheduled_tasks", "delete_scheduled_task"],
    "Cloud CLIs": ["run_kubectl", "run_azure_cli", "run_pac_cli", "run_viya_cli", "deploy_viya_status_page"],
    "VPN & Network": ["check_vpn_status", "vpn_keepalive"],
};
export function categorize(tools) {
    const seen = new Set();
    const out = [];
    for (const [cat, names] of Object.entries(CATEGORIES)) {
        const ts = tools.filter((t) => names.includes(t.name));
        ts.forEach((t) => seen.add(t.name));
        if (ts.length)
            out.push([cat, ts]);
    }
    const rest = tools.filter((t) => !seen.has(t.name));
    if (rest.length)
        out.push(["Other", rest]);
    return out;
}
/** The equivalent one-shot command, shown after a guided form so people learn the flags. Display only (quoting is approximate). */
export function cmdline(name, args) {
    const q = (v) => {
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return /^[\w./:\~@%+=,-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`;
    };
    return [name, ...Object.entries(args).map(([k, v]) => (v === true ? `--${k}` : `--${k} ${q(v)}`))].join(" ");
}
export function shortPath(p, home, max) {
    const s = p.startsWith(home) ? "~" + p.slice(home.length) : p;
    return s.length > max ? "…" + s.slice(-(max - 1)) : s;
}
