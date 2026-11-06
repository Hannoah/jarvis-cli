// Tiny terminal UI: an arrow-key menu with type-to-filter, and a one-line prompt with history. No dependencies.
// The prompt creates (and closes) a readline per call so the menu can own the keyboard in between.
import readline from "node:readline";
import { c, truncate } from "./cliutil.js";
export const SIGINT = Symbol("sigint");
const stdio = () => ({ input: process.stdin, output: process.stdout });
/** Resolves to the chosen value, or undefined on Esc / Ctrl+C. */
export function select(title, items, io = stdio()) {
    const { input, output } = io;
    readline.emitKeypressEvents(input);
    input.setRawMode?.(true);
    input.resume();
    const MAX = 10;
    let q = "", idx = 0, drawn = 0;
    const visible = () => items.filter((i) => `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    const draw = () => {
        const cols = (output.columns ?? 100) - 1; // never fill the last column: a wrapped line breaks the redraw
        const f = visible();
        idx = Math.max(0, Math.min(idx, f.length - 1));
        const start = Math.max(0, Math.min(idx - 4, f.length - MAX));
        const rows = f.slice(start, start + MAX).map((it, i) => {
            const hint = it.hint ? "  " + truncate(it.hint, Math.max(4, cols - 2 - it.label.length - 2)) : "";
            return start + i === idx ? c.cyan(`❯ ${it.label}`) + c.dim(hint) : `  ${it.label}` + c.dim(hint);
        });
        const help = q ? `  filter: ${q}` : "  type to filter · ↑↓ · Enter · Esc";
        const lines = [
            c.bold(truncate(title, cols)) + c.dim(truncate(help, Math.max(0, cols - title.length))),
            ...rows,
            ...(!f.length ? [c.dim("  no match")] : f.length > MAX ? [c.dim(`  ${idx + 1}/${f.length}`)] : []),
        ];
        if (drawn)
            output.write(`\x1b[${drawn}A\x1b[0J`);
        output.write(lines.join("\n") + "\n");
        drawn = lines.length;
    };
    return new Promise((resolve) => {
        const done = (v) => {
            input.off("keypress", onKey);
            input.setRawMode?.(false);
            if (drawn)
                output.write(`\x1b[${drawn}A\x1b[0J`);
            resolve(v);
        };
        const onKey = (str, key) => {
            const n = visible().length;
            if (key.ctrl && key.name === "c")
                return done(undefined);
            switch (key.name) {
                case "return": {
                    const it = visible()[idx];
                    if (it)
                        done(it.value);
                    return;
                }
                case "escape": return done(undefined);
                case "up":
                    idx = idx <= 0 ? n - 1 : idx - 1;
                    break;
                case "down":
                    idx = idx + 1 >= n ? 0 : idx + 1;
                    break;
                case "backspace":
                    q = q.slice(0, -1);
                    idx = 0;
                    break;
                default:
                    if (!str || str < " " || key.ctrl || key.meta)
                        return;
                    q += str;
                    idx = 0;
            }
            draw();
        };
        input.on("keypress", onKey);
        draw();
    });
}
/** One line of input. null = stdin closed (Ctrl+D), SIGINT = Ctrl+C. `history` is newest-first. */
export function ask(prompt, opts = {}, io = stdio()) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: io.input, output: io.output, history: opts.history ? [...opts.history] : undefined, historySize: 200, completer: opts.completer });
        let settled = false;
        const fin = (v) => {
            if (settled)
                return;
            settled = true;
            rl.close();
            resolve(v);
        };
        rl.on("SIGINT", () => fin(SIGINT));
        rl.on("close", () => fin(null));
        rl.question(prompt, (a) => fin(a));
    });
}
