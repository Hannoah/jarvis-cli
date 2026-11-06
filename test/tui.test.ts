import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { categorize, cmdline, shortPath } from "../src/cliutil.js";
import { select } from "../src/tui.js";

function fakeIO() {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() { return this; } });
  const output = Object.assign(new PassThrough(), { columns: 80 });
  return { input: input as never, output: output as never, press: (s: string) => setImmediate(() => input.write(s)) };
}
const items = [{ label: "alpha", value: 1 }, { label: "beta", value: 2 }, { label: "gamma", hint: "third", value: 3 }];

test("select: arrows + Enter, type-to-filter, Ctrl+C cancels", async () => {
  let io = fakeIO();
  let p = select("t", items, io);
  io.press("\x1b[B\r"); // down, Enter
  assert.equal(await p, 2);

  io = fakeIO();
  p = select("t", items, io);
  io.press("thi\r"); // filter matches the hint of "gamma"
  assert.equal(await p, 3);

  io = fakeIO();
  p = select("t", items, io);
  io.press("\x1b[A\r"); // up from the first item wraps to the last
  assert.equal(await p, 3);

  io = fakeIO();
  p = select("t", items, io);
  io.press("\x03");
  assert.equal(await p, undefined);
});

test("categorize groups known tools and keeps unknown ones under Other", () => {
  const g = categorize([{ name: "git_log" }, { name: "read_file" }, { name: "plugin_x" }]);
  assert.deepEqual(g.map(([n, t]) => [n, t.length]), [["Files", 1], ["Git", 1], ["Other", 1]]);
});

test("cmdline and shortPath", () => {
  assert.equal(cmdline("read_file", { path: "a b.txt", max_lines: 3, recursive: true }), 'read_file --path "a b.txt" --max_lines 3 --recursive');
  assert.equal(shortPath("C:\Users\me\Work\app", "C:\Users\me", 40), "~\Work\app");
  assert.equal(shortPath("/a/very/long/path/name", "/nohome", 8), "…th/name");
});

test("visibleLength ignores colour codes", async () => {
  const { visibleLength, stripAnsi } = await import("../src/cliutil.js");
  const E = String.fromCharCode(27);
  assert.equal(visibleLength(`${E}[1m${E}[38;5;75mab${E}[0m`), 2);
  assert.equal(stripAnsi(`${E}[2Kx`), "x");
});

test("ask: live suggestions appear under the input while typing and are cleared on submit", async () => {
  const { ask } = await import("../src/tui.js");
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() { return this; } });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
  let written = "";
  output.on("data", (d: Buffer) => (written += d.toString()));
  const p = ask("> ", { suggest: (l) => (l.startsWith("/st") ? [{ label: "/status", hint: "State of things", value: 1 }] : []) }, { input: input as never, output: output as never });
  setImmediate(() => input.write("/st"));
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(written.includes("/status") && written.includes("State of things"), "suggestion painted");
  const at = written.indexOf("State of things");
  input.write("\r");
  assert.equal(await p, "/st");
  assert.ok(written.lastIndexOf(`${String.fromCharCode(27)}[0J`) > at, "cleared after Enter");
});

test("withSpinner is transparent when stderr is not a terminal", async () => {
  const { withSpinner } = await import("../src/tui.js");
  const out = new PassThrough() as unknown as NodeJS.WriteStream; // isTTY undefined
  assert.equal(await withSpinner("x", Promise.resolve(42), out), 42);
  await assert.rejects(withSpinner("x", Promise.reject(new Error("boom")), out), /boom/);
});

test("ask: the footer (bottom border of the input box) is there from the first frame and wiped on submit", async () => {
  const { ask } = await import("../src/tui.js");
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() { return this; } });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
  let written = "";
  output.on("data", (d: Buffer) => (written += d.toString()));
  const p = ask("> ", { footer: "FOOTER-LINE" }, { input: input as never, output: output as never });
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(written.includes("FOOTER-LINE"), "footer painted before any key");
  const at = written.indexOf("FOOTER-LINE");
  input.write("x\r");
  assert.equal(await p, "x");
  assert.ok(written.lastIndexOf(`${String.fromCharCode(27)}[0J`) > at, "footer cleared after Enter");
});
