/**
 * Symbol outline without a real parser: indentation-aware for Python (matching the old `ast` output shape),
 * line-pattern based for other languages. Approximate by design: it exists to find WHERE to read, not to analyse code.
 */
import { splitLines } from "./textio.js";

export interface Symbol {
  type: string;
  name: string;
  line_start: number;
  line_end?: number;
  signature?: string;
  docstring?: string;
  methods?: Symbol[];
  preview?: string;
}

const indentOf = (l: string) => l.length - l.trimStart().length;
const blank = (l: string) => !l.trim() || l.trim().startsWith("#");

/** Index of the line where the header (possibly multi-line, parenthesised) ends, i.e. the one containing the final ':'. */
function headerEnd(lines: string[], i: number): number {
  let depth = 0;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]!.replace(/#.*$/, "")) {
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
    }
    if (depth <= 0 && lines[j]!.replace(/#.*$/, "").trimEnd().endsWith(":")) return j;
  }
  return i;
}

function paramNames(header: string): string {
  const open = header.indexOf("(");
  if (open < 0) return "()";
  let depth = 0;
  let cur = "";
  const parts: string[] = [];
  for (let k = open + 1; k < header.length; k++) {
    const ch = header[k]!;
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) {
      if (depth === 0) break;
      depth--;
    }
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const names = parts
    .map((p) => p.trim().replace(/\s*[:=].*$/s, ""))
    .filter((p) => p && p !== "*" && p !== "/");
  return `(${names.join(", ")})`;
}

function docFirstLine(lines: string[], from: number): string {
  for (let j = from; j < Math.min(lines.length, from + 3); j++) {
    const t = lines[j]!.trim();
    if (!t) continue;
    const m = /^[rRuUbBfF]{0,2}("""|''')(.*)$/.exec(t);
    if (!m) return "";
    const rest = m[2]!.replace(/("""|''')\s*$/, "").trim();
    if (rest) return rest;
    for (let k = j + 1; k < Math.min(lines.length, j + 4); k++) {
      const n = lines[k]!.trim();
      if (n) return n.replace(/("""|''')\s*$/, "").trim();
    }
    return "";
  }
  return "";
}

function blockEnd(lines: string[], bodyStart: number, indent: number): number {
  let last = bodyStart;
  for (let j = bodyStart + 1; j < lines.length; j++) {
    if (!lines[j]!.trim()) continue;
    if (indentOf(lines[j]!) <= indent && !lines[j]!.trim().startsWith("#")) break;
    if (!blank(lines[j]!)) last = j;
  }
  return last;
}

function pythonSymbols(lines: string[]): Symbol[] {
  const DEF = /^(\s*)(async\s+def|def|class)\s+([A-Za-z_]\w*)/;
  const out: Symbol[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DEF.exec(lines[i]!);
    if (!m || m[1]!.length !== 0) continue;
    const kind = m[2]!;
    const hEnd = headerEnd(lines, i);
    const header = lines.slice(i, hEnd + 1).join(" ");
    const end = blockEnd(lines, hEnd, 0);
    const sym: Symbol = {
      type: kind === "class" ? "class" : kind.startsWith("async") ? "async_function" : "function",
      name: m[3]!,
      line_start: i + 1,
      line_end: end + 1,
      docstring: docFirstLine(lines, hEnd + 1),
    };
    if (kind === "class") {
      sym.methods = [];
      let bodyIndent = -1;
      for (let j = hEnd + 1; j <= end; j++) {
        const mm = DEF.exec(lines[j]!);
        if (!mm || mm[2] === "class") continue;
        const ind = mm[1]!.length;
        if (bodyIndent < 0) bodyIndent = indentOf(lines[hEnd + 1 + lines.slice(hEnd + 1).findIndex((l) => l.trim())] ?? "") || ind;
        if (ind !== bodyIndent) continue;
        const mh = headerEnd(lines, j);
        sym.methods.push({
          type: "method",
          name: mm[3]!,
          signature: `${mm[3]}${paramNames(lines.slice(j, mh + 1).join(" "))}`,
          line_start: j + 1,
          line_end: blockEnd(lines, mh, ind) + 1,
          docstring: docFirstLine(lines, mh + 1),
        });
      }
    } else sym.signature = `${m[3]}${paramNames(header)}`;
    out.push(sym);
    i = Math.max(i, hEnd);
  }
  return out;
}

const MOD = String.raw`(?:public|private|protected|internal|static|async|override|virtual|abstract|final|sealed|export)`;
const GENERIC: [string, RegExp][] = [
  ["function", /^\s*function\s+([A-Za-z0-9_-]+)/],
  ["class", /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/],
  ["function", /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)\s*[(<]/],
  ["const_fn", /^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*(?::[^=]+)?=>/],
  ["interface", /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_]+)/],
  ["type", /^\s*(?:export\s+)?type\s+([A-Za-z0-9_]+)\s*(?:<[^=]*>)?\s*=/],
  ["enum", /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z0-9_]+)/],
  ["def", new RegExp(String.raw`^\s*(?:${MOD}\s+)+[A-Za-z0-9_<>\[\],.?]+\s+([A-Za-z0-9_]+)\s*\(`)],
];
const PER_LANG: Record<string, [string, RegExp][]> = {
  go: [["function", /^func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)/], ["type", /^type\s+([A-Za-z0-9_]+)\s+(?:struct|interface)/]],
  rs: [
    ["function", /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z0-9_]+)/],
    ["struct", /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z0-9_]+)/],
    ["enum", /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z0-9_]+)/],
    ["trait", /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z0-9_]+)/],
    ["impl", /^\s*impl(?:<[^>]*>)?\s+([A-Za-z0-9_:<>]+)/],
  ],
};

export function listSymbols(source: string, ext: string): { language: string; total_lines: number; symbols: Symbol[] } {
  const lines = splitLines(source);
  const e = ext.toLowerCase().replace(/^\./, "");
  if (e === "py") return { language: "python", total_lines: lines.length, symbols: pythonSymbols(lines) };
  const patterns = PER_LANG[e] ?? GENERIC;
  const symbols: Symbol[] = [];
  lines.forEach((line, i) => {
    for (const [type, re] of patterns) {
      const m = re.exec(line);
      if (m) {
        symbols.push({ type, name: m[1]!, line_start: i + 1, preview: line.trim().slice(0, 100) });
        break;
      }
    }
  });
  return { language: e || "text", total_lines: lines.length, symbols };
}
