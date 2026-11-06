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
