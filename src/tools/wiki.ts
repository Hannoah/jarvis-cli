/**
 * LLM Wiki: token-efficient knowledge base. The model reads the small index first, searches, and opens only the
 * documents it needs. Same on-disk format as the Python version (LLMWiki/index.md + <slug>.md).
 */
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Ctx } from "../core/context.js";
import { splitLines } from "../files/textio.js";
import { json, mutating, READ_ONLY } from "./common.js";

const now = () => new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function slugify(text: string): string {
  const s = text.trim().toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, "-").replace(/^-+|-+$/g, "");
  return s || "untitled";
}

/** Reads must not be able to leave the wiki dir (the original accepted "../../x"). */
const VALID_SLUG = /^[\p{L}\p{N}_-]+$/u;

export function registerWikiTools(mcp: McpServer, ctx: Ctx): void {
  const dir = ctx.cfg.wikiDir;
  const indexFile = path.join(dir, "index.md");
  const MUT = mutating(ctx.cfg);

  const ensure = () => {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(indexFile)) {
      fs.writeFileSync(
        indexFile,
        "# LLMWiki — Knowledge Base\n\nLLM 에이전트 전용 지식 위키입니다. 작업 시작 전 이 색인으로 필요한 문서를 찾으세요.\n\n---\n\n## 📚 Topics\n\n| 토픽 | 문서 | 설명 |\n|---|---|---|\n",
        "utf8",
      );
    }
  };
  const docs = () => fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "index.md").sort();
  // The '# Title' line sits at the top by convention: read 4 KB instead of the whole file,
  // falling back to a full read when the head has no (complete) heading so behavior is unchanged.
  const titleOf = (file: string, slug: string): string => {
    const full = (): string => {
      const first = splitLines(fs.readFileSync(file, "utf8")).find((l) => l.startsWith("# "));
      return first ? first.slice(2).trim() : slug;
    };
    let head = "";
    let cut = false;
    try {
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(4096);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        cut = n === buf.length;
        head = buf.subarray(0, n).toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return full(); // let the full read throw exactly as before
    }
    const lines = splitLines(head);
    const hit = lines.findIndex((l) => l.startsWith("# "));
    if (hit < 0 || (cut && hit === lines.length - 1)) return full();
    return lines[hit]!.slice(2).trim();
  };
  const topics = () =>
    docs().map((f) => {
      const slug = f.slice(0, -3);
      return { slug, title: titleOf(path.join(dir, f), slug) };
    });

  function register(slug: string, title: string, desc: string): void {
    let t = fs.readFileSync(indexFile, "utf8");
    if (t.includes(`(${slug}.md)`)) return;
    const row = `| **${title}** | [${slug}.md](${slug}.md) | ${desc} |\n`;
    // function replacer: titles/descriptions containing "$&" must stay literal
    t = t.includes("|---|---|---|") ? t.replace("|---|---|---|\n", () => `|---|---|---|\n${row}`) : `${t}\n${row}`;
    fs.writeFileSync(indexFile, t, "utf8");
  }
  function create(rawSlug: string, title: string, desc: string, content: string) {
    const slug = slugify(rawSlug);
    const p = path.join(dir, `${slug}.md`);
    fs.writeFileSync(p, `# ${title}\n\n_생성: ${now()}_\n\n${content}\n`, "utf8");
    register(slug, title, desc);
    return { created: slug, path: p };
  }

  mcp.registerTool(
    "wiki_index",
    {
      description:
        "Load the LIGHTWEIGHT wiki index (table of contents) only. Call this at the START of a session to see what knowledge exists — " +
        "WITHOUT loading every document (saves context/tokens). Then use `wiki_search` to locate, and `wiki_read` to open only what you need.",
      annotations: READ_ONLY,
    },
    async () => {
      ensure();
      ctx.audit("wiki_index", "ALLOW", "Loaded wiki index");
      return json({ index: fs.readFileSync(indexFile, "utf8"), topics: topics() });
    },
  );

  mcp.registerTool(
    "wiki_search",
    {
      description:
        "Search across all wiki docs and return WHICH doc/line matches. Returns small snippets with their source slug & line number " +
        "so you can then `wiki_read` only the relevant document instead of loading all.",
      inputSchema: { query: z.string().describe("Keyword or phrase to look for.") },
      annotations: READ_ONLY,
    },
    async ({ query }) => {
      ensure();
      const q = query.toLowerCase();
      const hits: { slug: string; line: number; snippet: string }[] = [];
      if (q) {
        for (const f of docs()) {
          const lines = splitLines(fs.readFileSync(path.join(dir, f), "utf8"));
          lines.forEach((line, i) => {
            if (line.toLowerCase().includes(q)) {
              hits.push({ slug: f.slice(0, -3), line: i + 1, snippet: lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2)).join("\n") });
            }
          });
        }
      }
      ctx.audit("wiki_search", "ALLOW", `query='${query}' hits=${hits.length}`);
      return json({ count: hits.length, hits });
    },
  );

  mcp.registerTool(
    "wiki_read",
    {
      description: "Read ONE wiki document by its slug (e.g. 'architecture-overview'). Use after `wiki_index`/`wiki_search` to load only the needed document.",
      inputSchema: { slug: z.string().describe("Document slug (filename without .md).") },
      annotations: READ_ONLY,
    },
    async ({ slug }) => {
      ensure();
      ctx.audit("wiki_read", "ALLOW", `slug=${slug}`);
      const p = VALID_SLUG.test(slug) ? path.join(dir, `${slug}.md`) : "";
      if (!p || !fs.existsSync(p)) return json({ error: `'${slug}.md' 문서를 찾을 수 없습니다.`, available: topics().map((t) => t.slug) });
      return json({ slug, content: fs.readFileSync(p, "utf8") });
    },
  );

  mcp.registerTool(
    "wiki_append",
    {
      description:
        "Append a new section to a wiki document (creates it if missing). Use to record durable knowledge: solved problems, decisions, user preferences, project state. Persists across sessions and models.",
      inputSchema: {
        slug: z.string().describe("Target document slug (e.g. 'session-notes')."),
        section: z.string().describe("Section heading to add."),
        content: z.string().describe("Markdown content for the section."),
      },
      annotations: MUT,
    },
    async ({ slug: raw, section, content }) => {
      ensure();
      const slug = slugify(raw);
      const p = path.join(dir, `${slug}.md`);
      ctx.backups.snapshot(p, "wiki_append");
      ctx.backups.snapshot(indexFile, "wiki_index_update");
      const block = `\n## ${section}\n\n_추가: ${now()}_\n\n${content}\n`;
      let res: Record<string, string>;
      if (fs.existsSync(p)) {
        fs.appendFileSync(p, block, "utf8");
        res = { appended: slug, section };
      } else {
        create(slug, slug, section, "");
        fs.appendFileSync(p, block, "utf8");
        res = { created_and_appended: slug, section };
      }
      ctx.audit("wiki_append", "ALLOW", `slug=${raw} section='${section}'`);
      return json(res);
    },
  );

  mcp.registerTool(
    "wiki_create",
    {
      description: "Create a NEW wiki topic document and auto-register it in the index.",
      inputSchema: {
        slug: z.string().describe("New document slug (filename without .md)."),
        title: z.string().describe("Human-readable document title (# heading)."),
        desc: z.string().default("").describe("One-line description shown in the index table."),
        content: z.string().default("").describe("Optional initial markdown body."),
      },
      annotations: MUT,
    },
    async ({ slug, title, desc, content }) => {
      ensure();
      ctx.backups.snapshot(path.join(dir, `${slugify(slug)}.md`), "wiki_create");
      ctx.backups.snapshot(indexFile, "wiki_index_update");
      const res = create(slug, title, desc, content);
      ctx.audit("wiki_create", "ALLOW", `slug=${slug}`);
      return json(res);
    },
  );
}
