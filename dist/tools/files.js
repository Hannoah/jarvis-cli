import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { timestamp } from "../core/audit.js";
import { isResolvedPathAllowed, protectionOfResolved, realResolve } from "../core/config.js";
import { globMatcher } from "../files/glob.js";
import { bufferEncoding, decodeText, splitLines } from "../files/textio.js";
import { json, mutating, READ_ONLY, resolveSafePath, SandboxViolationError, text } from "./common.js";
const SKIP_DIRS = new Set([".git", ".venv", "venv", "node_modules", "__pycache__", ".idea", ".vscode", "dist", "build", "target"]);
export function registerFileTools(mcp, ctx) {
    const { cfg, audit } = ctx;
    const MUT = mutating(cfg);
    /** Resolve inside the sandbox or return the error text for the caller to hand back. */
    const safe = (p, tool, mode = "read") => {
        try {
            return { path: resolveSafePath(ctx, p, tool, mode) };
        }
        catch (e) {
            if (e instanceof SandboxViolationError)
                return { error: e.message };
            throw e;
        }
    };
    mcp.registerTool("read_file", {
        description: "Read contents of a text file inside allowed directories with line pagination.",
        inputSchema: {
            path: z.string().describe("File path to read (must be within allowed_directories)."),
            start_line: z.number().int().default(1).describe("1-based starting line number (default 1)."),
            max_lines: z.number().int().default(300).describe("Maximum number of lines to read (default 300)."),
            encoding: z.string().default("utf-8").describe("Text encoding (default 'utf-8', automatically falls back to cp949)."),
        },
        annotations: READ_ONLY,
    }, async ({ path: p, start_line, max_lines, encoding }) => {
        if (!cfg.enableRead) {
            audit("read_file", "BLOCKED_POLICY", "File read disabled by user policy");
            return json({ error: "File read operations are disabled by policy (PC_MCP_ENABLE_READ=false)." });
        }
        const r = safe(p, "read_file");
        if ("error" in r)
            return json({ error: r.error });
        const target = r.path;
        let st;
        try {
            st = fs.statSync(target);
        }
        catch {
            return json({ error: `File not found: ${target}` });
        }
        if (!st.isFile())
            return json({ error: `File not found: ${target}` });
        if (st.size > cfg.maxReadBytes)
            return json({ error: `File too large (${st.size} bytes). Max allowed is ${cfg.maxReadBytes} bytes.` });
        let decoded;
        try {
            decoded = decodeText(fs.readFileSync(target), encoding);
        }
        catch (e) {
            return json({ error: e.message });
        }
        const lines = splitLines(decoded.text);
        const startIdx = Math.max(0, start_line - 1);
        const endIdx = Math.min(lines.length, startIdx + Math.max(0, max_lines));
        audit("read_file", "ALLOW", `${target} (lines ${startIdx + 1}-${endIdx})`);
        return json({
            path: target,
            encoding: decoded.encoding,
            total_lines: lines.length,
            start_line: startIdx + 1,
            end_line: endIdx,
            content: lines.slice(startIdx, endIdx).join("\n"),
        });
    });
    mcp.registerTool("write_file", {
        description: "Create, overwrite, or append text to a file inside allowed directories.",
        inputSchema: {
            path: z.string().describe("Target file path (must be within allowed_directories)."),
            content: z.string().describe("Text content to write."),
            append: z.boolean().default(false).describe("If true, appends to the end of the file; if false (default), overwrites the file."),
            encoding: z.string().default("utf-8").describe("Text encoding (default 'utf-8')."),
        },
        annotations: MUT,
    }, async ({ path: p, content, append, encoding }) => {
        if (!cfg.enableWrite) {
            audit("write_file", "BLOCKED_POLICY", "File write disabled by user policy");
            return text("Error: File write operations are disabled by policy (PC_MCP_ENABLE_WRITE=false).");
        }
        const r = safe(p, "write_file", "write");
        if ("error" in r)
            return text(r.error);
        const target = r.path;
        const enc = bufferEncoding(encoding);
        if (!enc)
            return text(`Error: unsupported write encoding '${encoding}' (use utf-8, utf-16le, latin1 or ascii).`);
        try {
            ctx.backups.snapshot(target, append ? "write_file_append" : "write_file_overwrite");
            fs.mkdirSync(path.dirname(target), { recursive: true });
            (append ? fs.appendFileSync : fs.writeFileSync)(target, Buffer.from(content, enc));
            audit("write_file", "ALLOW", `${append ? "append" : "write"} ${target} (${content.length} chars)`);
            return text(`Successfully ${append ? "appended to" : "wrote"} ${target} (${content.length} chars).`);
        }
        catch (e) {
            return text(`Error writing file ${target}: ${e.message}`);
        }
    });
    mcp.registerTool("edit_file", {
        description: "Modify an existing file inside allowed directories by replacing target_text with replacement_text.",
        inputSchema: {
            path: z.string().describe("File path to modify (must be within allowed_directories)."),
            target_text: z.string().describe("Exact existing string in the file to be replaced."),
            replacement_text: z.string().describe("New string to replace target_text with."),
            encoding: z.string().default("utf-8").describe("Text encoding (default 'utf-8')."),
            replace_all: z.boolean().default(false).describe("If true, replaces all occurrences. If false (default), target_text must appear exactly once."),
        },
        annotations: MUT,
    }, async ({ path: p, target_text, replacement_text, encoding, replace_all }) => {
        if (!cfg.enableWrite) {
            audit("edit_file", "BLOCKED_POLICY", "File edit disabled by user policy");
            return text("Error: File edit operations are disabled by policy (PC_MCP_ENABLE_WRITE=false).");
        }
        const r = safe(p, "edit_file", "write");
        if ("error" in r)
            return text(r.error);
        const target = r.path;
        if (!target_text)
            return text("Error: 'target_text' must not be empty.");
        let st;
        try {
            st = fs.statSync(target);
        }
        catch {
            return text(`Error: File not found: ${target}`);
        }
        if (!st.isFile())
            return text(`Error: File not found: ${target}`);
        const enc = bufferEncoding(encoding);
        if (!enc)
            return text(`Error: unsupported write encoding '${encoding}' (use utf-8, utf-16le, latin1 or ascii).`);
        const raw = fs.readFileSync(target);
        const decoded = decodeText(raw, encoding);
        if (decoded.encoding === "cp949")
            return text("Error: file is cp949-encoded; editing it would change its encoding. Convert it to UTF-8 first.");
        const parts = decoded.text.split(target_text);
        const count = parts.length - 1;
        if (count === 0)
            return text(`Error: 'target_text' not found in ${target}.`);
        if (count > 1 && !replace_all) {
            return text(`Error: 'target_text' appears ${count} times in ${target}. Please provide more unique surrounding context or pass replace_all=True.`);
        }
        ctx.backups.snapshot(target, "edit_file");
        // split/join, not String.replace: replacement text containing "$&" etc. must stay literal.
        fs.writeFileSync(target, Buffer.from(parts.join(replacement_text), enc));
        audit("edit_file", "ALLOW", `${target} (${count} replacements)`);
        return text(`Successfully replaced ${count} occurrence(s) in ${target}.`);
    });
    mcp.registerTool("list_files", {
        description: "List files and folders in an allowed directory, or search recursively using a glob pattern.",
        inputSchema: {
            directory: z.string().default("").describe("Target directory path (defaults to default_workdir; must be within allowed_directories)."),
            pattern: z.string().default("*").describe("Glob pattern to filter names (e.g. '*', '*.py', '*.pdf', '*보고서*')."),
            recursive: z.boolean().default(false).describe("If true, searches subdirectories recursively."),
            max_results: z.number().int().default(100).describe("Maximum number of items to return (default 100)."),
        },
        annotations: READ_ONLY,
    }, async ({ directory, pattern, recursive, max_results }) => {
        if (!cfg.enableRead) {
            audit("list_files", "BLOCKED_POLICY", "File listing disabled by user policy");
            return json({ error: "File listing operations are disabled by policy (PC_MCP_ENABLE_READ=false)." });
        }
        const r = safe(directory.trim() || cfg.defaultWorkdir, "list_files");
        if ("error" in r)
            return json({ error: r.error });
        const root = r.path;
        let st;
        try {
            st = fs.statSync(root);
        }
        catch {
            return json({ error: `Path does not exist: ${root}` });
        }
        if (!st.isDirectory())
            return json({ error: `Path is not a directory: ${root}` });
        const match = globMatcher(pattern);
        const needRel = /[\\/]/.test(pattern); // the matcher ignores its 2nd arg otherwise (same predicate as globMatcher)
        const items = [];
        const stack = [root];
        outer: while (stack.length) {
            const dir = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const ent of entries) {
                const full = path.join(dir, ent.name);
                if (match(ent.name, needRel ? path.relative(root, full).split(path.sep).join("/") : "")) {
                    try {
                        const s = fs.statSync(full);
                        items.push({
                            path: recursive ? path.relative(root, full) : ent.name,
                            type: s.isDirectory() ? "dir" : "file",
                            size_bytes: s.isFile() ? s.size : null,
                            modified: timestamp(new Date(s.mtimeMs)),
                        });
                        if (items.length >= max_results)
                            break outer;
                    }
                    catch {
                        /* unreadable entry */
                    }
                }
                if (recursive && ent.isDirectory() && !ent.isSymbolicLink())
                    stack.push(full);
            }
        }
        audit("list_files", "ALLOW", `${root} (pattern=${pattern}, recursive=${recursive}, count=${items.length})`);
        return json({ directory: root, pattern, recursive, count: items.length, items });
    });
    mcp.registerTool("search_in_files", {
        description: "Search for a text keyword or phrase inside files within allowed directories.",
        inputSchema: {
            query: z.string().describe("Keyword or text phrase to search for."),
            path: z.string().optional().describe("Optional directory to search within (defaults to default_workdir)."),
            file_pattern: z.string().default("*").describe("Glob pattern to filter file names (default '*' or e.g. '*.py', '*.txt')."),
            max_results: z.number().int().default(30).describe("Maximum number of matching lines to return (default 30, max 100)."),
            case_sensitive: z.boolean().default(false).describe("Whether the search should be case-sensitive (default False)."),
        },
        annotations: READ_ONLY,
    }, async ({ query, path: p, file_pattern, max_results, case_sensitive }) => {
        if (!cfg.enableRead)
            return json({ error: "File read operations are disabled by policy." });
        const r = safe(p || cfg.defaultWorkdir, "search_in_files");
        if ("error" in r)
            return json({ error: r.error });
        const root = r.path;
        try {
            if (!fs.statSync(root).isDirectory())
                throw new Error();
        }
        catch {
            return json({ error: `Search directory does not exist: ${root}` });
        }
        if (!query)
            return json({ error: "Invalid query: empty" });
        const limit = Math.min(Math.max(1, max_results), 100);
        const needle = case_sensitive ? query : query.toLowerCase();
        const match = file_pattern === "*" ? () => true : globMatcher(file_pattern);
        const needRel = /[\\/]/.test(file_pattern);
        const matches = [];
        const MAX_SCAN = 1500;
        let scanned = 0;
        const stack = [root];
        outer: while (stack.length) {
            const dir = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const ent of entries) {
                const full = path.join(dir, ent.name);
                // Symlinks are skipped: a link inside the sandbox must not lead to files outside it.
                if (ent.isSymbolicLink())
                    continue;
                if (ent.isDirectory()) {
                    if (!SKIP_DIRS.has(ent.name) && !ent.name.startsWith("."))
                        stack.push(full);
                    continue;
                }
                if (!ent.isFile())
                    continue;
                if (++scanned > MAX_SCAN)
                    break outer;
                if (!match(ent.name, needRel ? path.relative(root, full).split(path.sep).join("/") : ""))
                    continue;
                try {
                    if (fs.statSync(full).size > cfg.maxReadBytes)
                        continue;
                    if (!isSearchable(ctx, full))
                        continue;
                    const content = fs.readFileSync(full).toString("utf8");
                    if (content.includes("\0"))
                        continue;
                    const lines = splitLines(content);
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        if ((case_sensitive ? line : line.toLowerCase()).includes(needle)) {
                            matches.push({ file: path.relative(root, full), line: i + 1, text: line.trim().slice(0, 200) });
                            if (matches.length >= limit)
                                break outer;
                        }
                    }
                }
                catch {
                    /* unreadable file */
                }
            }
        }
        audit("search_in_files", "ALLOW", `query='${query}' root=${root} matches=${matches.length}`);
        return json({ root, query, count: matches.length, matches, hit_limit: matches.length >= limit });
    });
}
/**
 * Search must not surface outside-sandbox files or secrets (.env, token store).
 * Same rule as read-mode resolveSafePath, but the path is resolved once instead of three times
 * (this runs per scanned file, up to 1500 per call). The single resolve still matters: a
 * junction/reparse point under the root could otherwise smuggle foreign files into the results.
 */
function isSearchable(ctx, file) {
    const t = realResolve(file);
    return isResolvedPathAllowed(ctx.cfg, t) && protectionOfResolved(ctx.cfg, t) !== "secret";
}
