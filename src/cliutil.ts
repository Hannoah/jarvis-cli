// Pure CLI helpers: colors, argument parsing, result rendering. No Jarvis imports, so they are unit-testable.

export const isTTY = !!process.stdout.isTTY;
const colorOn = !process.env.NO_COLOR && (!!process.env.FORCE_COLOR || isTTY);
const sgr = (n: number) => (s: string) => (colorOn ? `\x1b[${n}m${s}\x1b[0m` : s);
export const c = { bold: sgr(1), dim: sgr(2), red: sgr(31), green: sgr(32), yellow: sgr(33), cyan: sgr(36) };

export type Prop = { type?: string | string[]; description?: string; enum?: unknown[] };
export type Schema = { properties?: Record<string, Prop>; required?: string[] };

const typeOf = (p?: Prop) => [p?.type ?? "string"].flat();

export function coerce(v: string, p?: Prop): unknown {
  const t = typeOf(p);
  if (t.includes("string")) return v;
  if (t.includes("number") || t.includes("integer")) return Number.isNaN(Number(v)) ? v : Number(v);
  if (t.includes("boolean")) return v !== "false";
  try { return JSON.parse(v); } catch { return v; }
}

/**
 * `--key value`, `--key=value`, bare `--flag` (true), `--json '{...}'`, and positionals that fill the
 * required params first, then the optional ones in schema order: `read_file notes.txt 1 20`.
 */
export function parseArgs(argv: string[], schema: Schema): { args: Record<string, unknown>; help: boolean } {
  const props = schema.properties ?? {};
  const order = [...(schema.required ?? []), ...Object.keys(props).filter((k) => !schema.required?.includes(k))];
  let args: Record<string, unknown> = {};
  let help = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === "--help" || tok === "-h") { help = true; continue; }
    const m = /^--([^=]+)(?:=(.*))?$/.exec(tok);
    if (!m) { positional.push(tok); continue; }
    const key = m[1]!.replace(/-/g, "_");
    const next = argv[i + 1];
    // a boolean flag only swallows an explicit true/false, so `--recursive src` keeps `src` positional
    const takesNext = next !== undefined && !next.startsWith("--") && (!typeOf(props[key]).includes("boolean") || /^(true|false)$/.test(next));
    const raw = m[2] ?? (takesNext ? argv[++i] : undefined);
    if (key === "json") args = { ...(JSON.parse(raw ?? "{}") as object), ...args };
    else if (!(key in props)) throw new Error(`Unknown argument --${key}. See: jarvis help <tool>`);
    else args[key] = raw === undefined ? true : coerce(raw, props[key]);
  }
  for (const v of positional) {
    const key = order.find((k) => args[k] === undefined);
    if (!key) throw new Error(`Unexpected argument '${v}'. See: jarvis help <tool>`);
    args[key] = coerce(v, props[key]);
  }
  return { args, help };
}

/** Split a shell-ish line into tokens, honouring '…' and "…" (no escapes, so Windows paths survive). */
export const tokenize = (s: string): string[] =>
  (s.match(/(?:"[^"]*"|'[^']*'|\S)+/g) ?? []).map((t) => t.replace(/"([^"]*)"|'([^']*)'/g, (_, a, b) => a ?? b));

const lev = (a: string, b: string): number => {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
};

/** "Did you mean": names containing the input, else the closest by edit distance. */
export function suggest(name: string, names: string[]): string[] {
  const n = name.toLowerCase().replace(/-/g, "_");
  const sub = names.filter((x) => x.includes(n));
  if (sub.length) return sub.slice(0, 3);
  return names.map((x) => [lev(n, x), x] as const).filter(([d]) => d <= 3).sort((a, b) => a[0] - b[0]).slice(0, 3).map(([, x]) => x);
}

export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s);

type Row = Record<string, unknown>;
const scalar = (v: unknown) => v === null || typeof v !== "object";
const cell = (v: unknown) => (v == null ? "-" : typeof v === "object" ? JSON.stringify(v) : String(v));
const isRows = (v: unknown): v is Row[] =>
  Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === "object" && !Array.isArray(r) && Object.values(r).every(scalar));

// ponytail: pads by string length, so double-width (CJK) cells misalign slightly; use a width lib if that matters
export function table(rows: Row[], maxCell = 60): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const body = rows.map((r) => cols.map((k) => truncate(cell(r[k]), maxCell)));
  const w = cols.map((k, i) => Math.max(k.length, ...body.map((r) => r[i]!.length)));
  const line = (cells: string[], f: (s: string) => string) => cells.map((s, i) => f(s.padEnd(w[i]!))).join("  ").trimEnd();
  return [line(cols, (s) => c.bold(s)), ...body.map((r) => line(r, (s) => s))].join("\n");
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2).replace(/^(\s*)"([^"]+)":/gm, (_, sp, k) => `${sp}${c.cyan(`"${k}"`)}:`);

/** Human view of a tool's text result: file content as-is, row lists as a table, anything else indented JSON. */
export function render(text: string): string {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return text; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return pretty(v);
  const o = v as Row;
  const meta = (skip: string[]) =>
    Object.entries(o).filter(([k, x]) => !skip.includes(k) && scalar(x)).map(([k, x]) => `${k}=${cell(x)}`).join("  ");
  const rest = (skip: string[]) => Object.entries(o).every(([k, x]) => skip.includes(k) || scalar(x));
  const head = (skip: string[]) => (meta(skip) ? c.dim(meta(skip)) + "\n" : "");
  if (typeof o.stdout === "string" && typeof o.stderr === "string" && rest(["stdout", "stderr"])) {
    const out = [o.stdout.trimEnd(), o.stderr.trimEnd() && c.red(o.stderr.trimEnd())].filter(Boolean).join("\n");
    return head(["stdout", "stderr"]) + out;
  }
  if (typeof o.content === "string" && rest(["content"])) return head(["content"]) + o.content;
  const rowsKey = Object.keys(o).find((k) => isRows(o[k]));
  if (rowsKey && rest([rowsKey])) return head([rowsKey]) + table(o[rowsKey] as Row[]);
  return pretty(v);
}

/** Tools report failures as {"error": "..."} text; pull the message out (and what else came with it). */
export function errorOf(text: string): { message: string; extra?: string } | null {
  try {
    const o = JSON.parse(text) as Row;
    if (!o || typeof o.error !== "string") return null;
    const { error, success, ...extra } = o;
    return { message: error, extra: Object.keys(extra).length ? pretty(extra) : undefined };
  } catch { return null; }
}

/** Process-style results ({exit_code: 3, ...}) fail the CLI too. */
export const exitCodeOf = (text: string): number => {
  try { const n = (JSON.parse(text) as Row).exit_code; return typeof n === "number" ? n : 0; } catch { return 0; }
};

export function usage(name: string, schema: Schema): string {
  const props = schema.properties ?? {};
  const req = schema.required ?? [];
  const parts = [
    ...req.map((k) => `<${k}>`),
    ...Object.entries(props).filter(([k]) => !req.includes(k)).map(([k, p]) => `[--${k} <${typeOf(p).join("|")}>]`),
  ];
  return `jarvis ${name} ${parts.join(" ")}`.trimEnd();
}

export function toolHelp(t: { name: string; description?: string; inputSchema: unknown }): string {
  const schema = t.inputSchema as Schema;
  const props = Object.entries(schema.properties ?? {});
  const rows = props.map(([k, p]) => ({
    param: `--${k}`,
    type: typeOf(p).join("|") + (p.enum ? ` (${p.enum.join("|")})` : ""),
    "": schema.required?.includes(k) ? "required" : "",
    description: (p.description ?? "").split("\n")[0]!,
  }));
  return [
    c.bold(t.name),
    t.description ?? "",
    "",
    `${c.dim("Usage:")} ${usage(t.name, schema)}`,
    ...(rows.length ? ["", table(rows, 90)] : []),
  ].join("\n");
}
