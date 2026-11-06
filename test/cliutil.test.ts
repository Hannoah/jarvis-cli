import assert from "node:assert/strict";
import { test } from "node:test";
import { errorOf, parseArgs, render, suggest, tokenize } from "../src/cliutil.js";

const schema = {
  properties: { path: { type: "string" }, start_line: { type: "integer" }, recursive: { type: "boolean" }, tags: { type: "array" } },
  required: ["path"],
};

test("parseArgs: flags, =, json, positionals, boolean handling", () => {
  assert.deepEqual(parseArgs(["--path", "a.txt", "--start_line=5"], schema).args, { path: "a.txt", start_line: 5 });
  assert.deepEqual(parseArgs(["a.txt", "7"], schema).args, { path: "a.txt", start_line: 7 }); // required first, then schema order
  assert.deepEqual(parseArgs(["--recursive", "src"], schema).args, { recursive: true, path: "src" }); // bool flag does not eat `src`
  assert.deepEqual(parseArgs(["--tags", '["x"]', "--json", '{"path":"p","start_line":1}'], schema).args, { path: "p", start_line: 1, tags: ["x"] });
  assert.equal(parseArgs(["a", "--help"], schema).help, true);
  assert.throws(() => parseArgs(["--nope", "1"], schema), /Unknown argument --nope/);
  assert.throws(() => parseArgs(["a", "1", "true", "[]", "extra"], schema), /Unexpected argument/);
});

test("tokenize keeps quotes grouped and Windows paths intact", () => {
  assert.deepEqual(tokenize(`run_terminal --command "Get-Date -Format o" --cwd C:\Users\me`), ["run_terminal", "--command", "Get-Date -Format o", "--cwd", "C:\Users\me"]);
  assert.deepEqual(tokenize(`x --json '{"a":1}' --k="a b"`), ["x", "--json", '{"a":1}', "--k=a b"]);
});

test("suggest: substring first, then edit distance", () => {
  const names = ["read_file", "write_file", "git_status", "git_log"];
  assert.deepEqual(suggest("file", names), ["read_file", "write_file"]);
  assert.deepEqual(suggest("git_staus", names), ["git_status"]);
  assert.deepEqual(suggest("zzzzzzzz", names), []);
});

test("render: content as-is, rows as table, other JSON indented; errorOf extracts message", () => {
  assert.equal(render(JSON.stringify({ path: "a", content: "hello\nworld" })), "path=a\nhello\nworld");
  assert.equal(render('{"count":2,"items":[{"p":"a","t":"file"},{"p":"bb","t":"dir"}]}'), "count=2\np   t\na   file\nbb  dir");
  assert.equal(render("not json"), "not json");
  assert.match(render('{"a":{"b":1}}'), /^\{\n {2}"a": \{/);
  assert.deepEqual(errorOf('{"success":false,"error":"boom","hint":"x"}'), { message: "boom", extra: '{\n  "hint": "x"\n}' });
  assert.equal(errorOf('{"ok":1}'), null);
});

test("themes, gradient and human sizes", async () => {
  const { setTheme, currentTheme, gradient, humanBytes, themeNames, render } = await import("../src/cliutil.js");
  assert.ok(themeNames.includes("violet"));
  assert.equal(setTheme("nope"), false);
  assert.equal(setTheme("violet"), true);
  assert.equal(currentTheme(), "violet");
  setTheme("blue");
  assert.equal(gradient("ab\ncd"), "ab\ncd"); // colours are off under test, text is untouched
  assert.deepEqual([512, 1536, 5 * 1024 * 1024, null].map(humanBytes), ["512 B", "1.5 KB", "5.0 MB", "-"]);
  const out = render(JSON.stringify({ count: 1, items: [{ path: "a.ts", type: "file", size_bytes: 1536 }] }));
  assert.ok(out.includes("1.5 KB") && !out.includes("size_bytes"), out);
});
