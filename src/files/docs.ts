/** Office/PDF text extraction without a ZIP or XML dependency (OOXML is regular enough for targeted regexes). */
import fs from "node:fs";
import zlib from "node:zlib";
import { decodeEntities } from "../security/net.js";

const MAX_ENTRY = 64 * 1024 * 1024; // zip-bomb guard per entry
const MAX_COLS = 16384; // Excel maximum column limit (XFD) to prevent OOM on malicious or malformed sheets

/** Minimal ZIP reader: central directory + inflate. Handles stored and deflated entries (no zip64/encryption). */
export class Zip {
  private entries = new Map<string, { method: number; csize: number; offset: number }>();
  constructor(private buf: Buffer) {
    if (buf.length < 22) throw new Error("Not a valid ZIP/Office file.");
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("Not a valid ZIP/Office file.");
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
      if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt ZIP directory.");
      const method = buf.readUInt16LE(p + 10);
      const csize = buf.readUInt32LE(p + 20);
      const nlen = buf.readUInt16LE(p + 28);
      const elen = buf.readUInt16LE(p + 30);
      const clen = buf.readUInt16LE(p + 32);
      const offset = buf.readUInt32LE(p + 42);
      if (p + 46 + nlen > buf.length) throw new Error("Corrupt ZIP filename header.");
      this.entries.set(buf.toString("utf8", p + 46, p + 46 + nlen), { method, csize, offset });
      p += 46 + nlen + elen + clen;
    }
  }
  names(): string[] {
    return [...this.entries.keys()];
  }
  has(name: string): boolean {
    return this.entries.has(name);
  }
  read(name: string): string {
    const e = this.entries.get(name);
    if (!e) throw new Error(`Missing ${name}`);
    if (e.offset + 30 > this.buf.length) throw new Error(`Corrupt entry header for ${name}`);
    const nlen = this.buf.readUInt16LE(e.offset + 26);
    const elen = this.buf.readUInt16LE(e.offset + 28);
    const start = e.offset + 30 + nlen + elen;
    if (start + e.csize > this.buf.length) throw new Error(`Truncated or corrupt entry data for ${name}`);
    const raw = this.buf.subarray(start, start + e.csize);
    if (e.method === 0) return raw.toString("utf8");
    if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY }).toString("utf8");
    throw new Error(`Unsupported ZIP compression method ${e.method}`);
  }
}

const texts = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => decodeEntities(m[1]!));

export function readDocx(z: Zip): string {
  if (!z.has("word/document.xml")) return "Error: Invalid .docx file (missing word/document.xml).";
  const xml = z.read("word/document.xml");
  const paras: string[] = [];
  for (const p of xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const t = texts(p[0], "w:t").join("");
    if (t) paras.push(t);
  }
  return paras.join("\n");
}

const colIndex = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, "").toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
    if (n > MAX_COLS) return -1; // invalid or extreme column coordinate
  }
  return n - 1;
};

export function readXlsx(z: Zip): string {
  const shared: string[] = [];
  if (z.has("xl/sharedStrings.xml")) {
    for (const si of z.read("xl/sharedStrings.xml").matchAll(/<si[\s>][\s\S]*?<\/si>|<si\/>/g)) shared.push(texts(si[0], "t").join(""));
  }
  const sheets = z.names().filter((f) => /^xl\/worksheets\/sheet[^/]*\.xml$/.test(f)).sort();
  return sheets
    .map((sf) => {
      const rows: string[] = [];
      for (const row of z.read(sf).matchAll(/<row[\s>][\s\S]*?<\/row>/g)) {
        const vals: string[] = [];
        for (const c of row[0].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = c[1]!;
          const body = c[2] ?? "";
          const type = /\bt="([^"]*)"/.exec(attrs)?.[1] ?? "";
          const ref = /\br="([^"]*)"/.exec(attrs)?.[1];
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
          let val = "";
          if (v !== undefined) {
            const idx = Number(v);
            val = type === "s" ? (shared[idx] ?? decodeEntities(v)) : decodeEntities(v);
          } else if (/<t[\s>]/.test(body)) val = texts(body, "t").join("");
          // place by column so empty cells keep later columns aligned
          const cIdx = ref ? colIndex(ref) : vals.length;
          const at = cIdx >= 0 && cIdx < MAX_COLS ? cIdx : vals.length;
          while (vals.length < at && vals.length < MAX_COLS) vals.push("");
          if (at < MAX_COLS) vals[at] = val;
        }
        if (vals.some((x) => x.trim())) rows.push(vals.join(" | "));
      }
      return `### Sheet: ${sf.split("/").pop()!.replace(/\.xml$/, "")}\n${rows.join("\n")}`;
    })
    .join("\n\n");
}

export function readPptx(z: Zip): string {
  const slides = z.names().filter((f) => /^ppt\/slides\/slide[^/]*\.xml$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out: string[] = [];
  slides.forEach((sf, i) => {
    const t = texts(z.read(sf), "a:t").map((s) => s.trim()).filter(Boolean);
    if (t.length) out.push(`### Slide ${i + 1}\n${t.join("\n")}`);
  });
  return out.join("\n\n");
}

export async function readPdf(file: string): Promise<string> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((t: string, i: number) => `--- Page ${i + 1} ---\n${t}`).join("\n\n");
}

export async function readDocumentText(file: string, ext: string): Promise<string> {
  if (ext === ".docx") return readDocx(new Zip(fs.readFileSync(file)));
  if (ext === ".xlsx" || ext === ".xlsm") return readXlsx(new Zip(fs.readFileSync(file)));
  if (ext === ".pptx") return readPptx(new Zip(fs.readFileSync(file)));
  if (ext === ".pdf") return readPdf(file);
  return fs.readFileSync(file).toString("utf8");
}
