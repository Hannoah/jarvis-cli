// Tiny terminal UI, no dependencies: an arrow-key menu panel with type-to-filter, a spinner, and a one-line prompt with
// history and live suggestions. The prompt creates (and closes) a readline per call so the menu can own the keyboard in between.
import readline from "node:readline";
import { c, truncate, visibleLength } from "./cliutil.js";

export const SIGINT = Symbol("sigint");
export interface IO { input: NodeJS.ReadStream; output: NodeJS.WriteStream }
const stdio = (): IO => ({ input: process.stdin, output: process.stdout });

export type Item<T> = { label: string; hint?: string; value: T };

const MAX = 10;
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));

/** Resolves to the chosen value, or undefined on Esc / Ctrl+C. */
export function select<T>(title: string, items: Item<T>[], io: IO = stdio()): Promise<T | undefined> {
  const { input, output } = io;
  readline.emitKeypressEvents(input);
  input.setRawMode?.(true);
  input.resume();
  output.write("\x1b[?25l"); // hide the cursor while the panel is up
  let q = "", idx = 0, drawn = 0;
  const visible = () => items.filter((i) => `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  const draw = () => {
    const cols = (output.columns ?? 100) - 1; // never fill the last column: a wrapped line breaks the redraw
    const f = visible();
    idx = Math.max(0, Math.min(idx, f.length - 1));
    const start = Math.max(0, Math.min(idx - 4, f.length - MAX));
    const shown = f.slice(start, start + MAX);
    const labelW = Math.min(30, Math.max(0, ...shown.map((it) => it.label.length)));
    const bar = c.accent("│") + " ";
    const body = shown.map((it, i) => {
      const room = cols - 2 - 2 - labelW - 2;
      const hint = it.hint && room >= 8 ? "  " + truncate(it.hint, room) : "";
      const text = `${pad(it.label, labelW)}${hint}`;
      return bar + (start + i === idx ? c.hl(pad(`❯ ${text}`, cols - 2)) : `  ${it.label.length > labelW ? text : pad(it.label, labelW)}` + c.gray(hint));
    });
    const lines = [
      c.accent("╭─ ") + c.bold(truncate(title, cols - 4)) + c.gray(truncate(q ? `  ·  filter: ${q}▏` : "  ·  type to filter", Math.max(0, cols - title.length - 4))),
      ...(start > 0 ? [bar + c.gray(`↑ ${start} more`)] : []),
      ...body,
      ...(start + MAX < f.length ? [bar + c.gray(`↓ ${f.length - start - MAX} more`)] : []),
      ...(!f.length ? [bar + c.gray("no match")] : []),
      c.accent("╰─ ") + c.gray(truncate(`↑↓ move · Enter select · Esc cancel${f.length > MAX ? `  ·  ${idx + 1}/${f.length}` : ""}`, cols - 4)),
    ];
    if (drawn) output.write(`\x1b[${drawn}A\x1b[0J`);
    output.write(lines.join("\n") + "\n");
    drawn = lines.length;
  };

  return new Promise((resolve) => {
    const done = (v: T | undefined) => {
      input.off("keypress", onKey);
      input.setRawMode?.(false);
      if (drawn) output.write(`\x1b[${drawn}A\x1b[0J`);
      output.write("\x1b[?25h");
      resolve(v);
    };
    const onKey = (str: string | undefined, key: readline.Key) => {
      const n = visible().length;
      if (key.ctrl && key.name === "c") return done(undefined);
      switch (key.name) {
        case "return": {
          const it = visible()[idx];
          if (it) done(it.value);
          return;
        }
        case "escape": return done(undefined);
        case "up": idx = idx <= 0 ? n - 1 : idx - 1; break;
        case "down": idx = idx + 1 >= n ? 0 : idx + 1; break;
        case "pageup": idx = Math.max(0, idx - MAX); break;
        case "pagedown": idx = Math.min(n - 1, idx + MAX); break;
        case "home": idx = 0; break;
        case "end": idx = Math.max(0, n - 1); break;
        case "backspace": q = q.slice(0, -1); idx = 0; break;
        default:
          if (!str || str < " " || key.ctrl || key.meta) return;
          q += str; idx = 0;
      }
      draw();
    };
    input.on("keypress", onKey);
    draw();
  });
}

/** Braille spinner on stderr while `p` is pending. Appears only after 250 ms, so quick calls never flicker; no-op when stderr is not a terminal. */
export async function withSpinner<T>(label: string, p: Promise<T>, out: NodeJS.WriteStream = process.stderr): Promise<T> {
  if (!out.isTTY) return p;
  const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  const t0 = Date.now();
  let i = 0, shown = false, timer: NodeJS.Timeout | undefined;
  const tick = () => {
    shown = true;
    out.write(`\r\x1b[2K${c.accent(frames[i++ % frames.length]!)} ${label} ${c.gray(`${((Date.now() - t0) / 1000).toFixed(1)}s`)}`);
  };
  const start = setTimeout(() => {
    out.write("\x1b[?25l");
    tick();
    timer = setInterval(tick, 90);
  }, 250);
  try {
    return await p;
  } finally {
    clearTimeout(start);
    if (timer) clearInterval(timer);
    if (shown) out.write("\r\x1b[2K\x1b[?25h");
  }
}

/**
 * One line of input. null = stdin closed (Ctrl+D), SIGINT = Ctrl+C. `history` is newest-first.
 * `suggest(line)` is shown live under the input while typing (readline wipes everything below the cursor when it
 * redraws, so the list is repainted after every key; it is cleared when the line is submitted).
 */
export function ask(
  prompt: string,
  opts: { history?: string[]; completer?: readline.Completer; suggest?: (line: string) => Item<unknown>[]; footer?: string; onClear?: () => string } = {},
  io: IO = stdio(),
): Promise<string | typeof SIGINT | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: io.input, output: io.output, history: opts.history ? [...opts.history] : undefined, historySize: 200, completer: opts.completer });
    let settled = false;
    let drawn = 0;
    const col = () => visibleLength(prompt) + ((rl as unknown as { cursor?: number }).cursor ?? rl.line.length) + 1;
    const clearBelow = () => {
      if (!drawn) return;
      io.output.write(`\x1b[1E\x1b[0J\x1b[1A\x1b[${col()}G`);
      drawn = 0;
    };
    const paint = (_s?: string, key?: { ctrl?: boolean; name?: string }) => {
      if (settled) return;
      if (key?.ctrl && key.name === "l" && opts.onClear) {
        // readline just cleared the screen: draw the header again above the prompt, then the prompt and the line being typed
        drawn = 0;
        io.output.write("\x1b[2J\x1b[H" + opts.onClear() + "\n");
        rl.prompt(true);
      }
      const items = (opts.suggest?.(rl.line) ?? []).slice(0, 6);
      const cols = (io.output.columns ?? 100) - 1;
      const labels = items.map((it) => truncate(it.label, Math.max(8, cols - 4)));
      const w = Math.min(24, Math.max(0, ...labels.map((l) => l.length)));
      const lines = [
        ...(opts.footer ? [opts.footer] : []), // e.g. the bottom border of the input box, then the suggestions
        ...items.map((it, i) => {
          const room = cols - 4 - w - 2;
          return "  " + c.accent(pad(labels[i]!, w)) + (it.hint && room >= 8 ? c.gray("  " + truncate(it.hint, room)) : "");
        }),
      ];
      if (!lines.length) return clearBelow();
      clearBelow();
      io.output.write("\n" + lines.join("\n") + `\x1b[${lines.length}A\x1b[${col()}G`);
      drawn = lines.length;
    };
    const fin = (v: string | typeof SIGINT | null) => {
      if (settled) return;
      settled = true;
      io.input.off("keypress", paint);
      // after Enter the cursor is already on the first suggestion row; otherwise step down onto it
      if (drawn) io.output.write(typeof v === "string" ? "\x1b[0J" : "\x1b[1E\x1b[0J");
      rl.close();
      resolve(v);
    };
    rl.on("SIGINT", () => fin(SIGINT));
    rl.on("close", () => fin(null));
    io.input.on("keypress", paint); // registered after readline's own handler, so rl.line is already up to date
    rl.question(prompt, (a) => fin(a));
    paint(); // the footer (if any) is there from the first frame, not only after the first key
  });
}
