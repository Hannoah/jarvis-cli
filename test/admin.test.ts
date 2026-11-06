import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { adminCommand } from "../src/admin.js";
import { loadConfig, readEnvFile } from "../src/core/config.js";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-admin-"));
  const [a, b, c] = ["a", "b", "c"].map((n) => fs.mkdirSync(path.join(root, n), { recursive: true }) && fs.realpathSync(path.join(root, n)));
  const data = path.join(root, "data");
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, ".env"), `PC_MCP_ALLOWED_DIRS=${a};${b}\n`);
  const cfg = loadConfig({ projectDir: root, dataDir: data });
  return { cfg, a: a!, b: b!, c: c!, env: () => readEnvFile(path.join(data, ".env")) };
}
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const log = console.log, err = console.error;
  console.log = console.error = () => undefined;
  try { return await f(); } finally { console.log = log; console.error = err; }
};
const run = (cfg: ReturnType<typeof setup>["cfg"], name: string, ...args: string[]) => quiet(() => adminCommand(name, args, cfg));

test("dirs: add/remove persist and update the live config; roots, missing folders and an empty list are refused", async () => {
  const { cfg, a, b, c, env } = setup();
  assert.equal(await run(cfg, "dirs", "add", c), 0);
  assert.deepEqual(cfg.allowedDirs, [a, b, c]);
  assert.equal(env().PC_MCP_ALLOWED_DIRS, [a, b, c].join(";"));
  assert.equal(await run(cfg, "dirs", "remove", a), 0);
  assert.deepEqual(cfg.allowedDirs, [b, c]);
  assert.equal(await run(cfg, "dirs", "add", path.parse(a).root), 1); // drive root would disable the sandbox
  assert.equal(await run(cfg, "dirs", "add", path.join(a, "missing")), 1);
  assert.equal(await run(cfg, "dirs", "remove", b, c), 1); // never leave the list empty
  assert.deepEqual(cfg.allowedDirs, [b, c]);
});

test("permissions: switches persist; blocklist needs --yes; bad input is refused", async () => {
  const { cfg, env } = setup();
  assert.equal(await run(cfg, "permissions", "write", "off"), 0);
  assert.equal(cfg.enableWrite, false);
  assert.equal(env().PC_MCP_ENABLE_WRITE, "false");
  assert.equal(await run(cfg, "permissions", "mode", "blocklist"), 1);
  assert.equal(cfg.terminalMode, "allowlist");
  assert.equal(await run(cfg, "permissions", "mode", "blocklist", "--yes"), 0);
  assert.equal(cfg.terminalMode, "blocklist");
  assert.equal(await run(cfg, "permissions", "read", "maybe"), 1);
  assert.equal(await run(cfg, "permissions", "write", "on"), 0);
  assert.equal(cfg.enableWrite, true);
});

test("allowlist: add/remove user commands, broad ones need --yes, built-ins cannot be removed, check uses the real policy", async () => {
  const { cfg } = setup();
  assert.equal(await run(cfg, "allowlist", "add", "zzcmd"), 0);
  assert.ok(cfg.extraAllowedCommands.has("zzcmd"));
  assert.equal(await run(cfg, "allowlist", "add", "pwsh"), 1);
  assert.ok(!cfg.extraAllowedCommands.has("pwsh"));
  assert.equal(await run(cfg, "allowlist", "add", "pwsh", "--yes"), 0);
  assert.ok(cfg.extraAllowedCommands.has("pwsh"));
  assert.equal(await run(cfg, "allowlist", "remove", "git"), 1); // built-in
  assert.equal(await run(cfg, "allowlist", "remove", "zzcmd", "pwsh"), 0);
  assert.ok(!cfg.extraAllowedCommands.has("zzcmd") && !cfg.extraAllowedCommands.has("pwsh"));
  assert.equal(await run(cfg, "allowlist", "check", "git status"), 0);
  assert.equal(await run(cfg, "allowlist", "check", "definitely-not-allowed-cmd --x"), 1);
});

test("stop/status with no supervisor running report 'not running' and succeed", async () => {
  const { cfg } = setup();
  assert.equal(await run(cfg, "status"), 0);
  assert.equal(await run(cfg, "stop"), 0);
  assert.equal(await run(cfg, "restart"), 1); // nothing to restart
});

test("a dashboard that rejects our token gives an explanation instead of a bare HTTP 401", async () => {
  const http = await import("node:http");
  const srv = http.createServer((_req, res) => { res.statusCode = 401; res.end("Open the dashboard URL printed by Jarvis"); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as { port: number }).port;
  const { cfg } = setup();
  fs.appendFileSync(cfg.envFile, `JARVIS_DASHBOARD_PORT=${port}\n`);
  fs.writeFileSync(path.join(cfg.dataDir, ".dashboard_token"), "stale-token"); // left behind by an earlier start that lost the port
  const errors: string[] = [];
  const orig = console.error;
  console.error = (m?: unknown) => void errors.push(String(m));
  try {
    for (const name of ["status", "stop", "restart"]) {
      errors.length = 0;
      assert.equal(await adminCommand(name, [], cfg), 1, name);
      assert.match(errors.join("\n"), /rejected this settings folder's token[\s\S]*JARVIS_HOME/, name);
      assert.doesNotMatch(errors.join("\n"), /^✖ HTTP 401/, name);
    }
  } finally {
    console.error = orig;
    srv.close();
  }
});
