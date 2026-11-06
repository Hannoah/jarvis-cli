import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { identityFile, loadConfig, protectionOf, readEnvFile } from "../src/core/config.js";
import { updateEnvFile } from "../src/core/envfile.js";
import { createCtx } from "../src/core/context.js";
import { getOrCreateApiKey } from "../src/security/auth.js";
import { readIdentity, syncIdentity } from "../src/security/identity.js";
import { createHttpServer } from "../src/server/http.js";
import { applyTunnelUpdate } from "../src/supervisor/index.js";
import { applySettings, regenerateApiKey } from "../src/supervisor/settings.js";

/** One PC (home) with two settings folders: the situation of jarvis-ts/data next to ~/.jarvis. */
function pc() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-id-")));
  const home = path.join(root, "home");
  const cfg = (name: string) => {
    const data = path.join(root, name);
    fs.mkdirSync(data, { recursive: true });
    return loadConfig({ projectDir: root, dataDir: data, home, env: {} });
  };
  return { home, a: cfg("a"), b: cfg("b") };
}
const envOf = (cfg: { envFile: string }) => readEnvFile(cfg.envFile);

test("one PC, one key: another settings folder, a restart or an upgrade all use the same API key", () => {
  const { home, a, b } = pc();
  const key = getOrCreateApiKey(a);
  assert.match(key, /^pcmcp_/);
  assert.equal(getOrCreateApiKey(a), key); // restart / upgrade
  assert.equal(getOrCreateApiKey(b), key); // a different settings folder on the same PC
  assert.equal(envOf(b).PC_MCP_API_KEY, key);
  assert.equal(readIdentity(home).apiKey, key);
});

test("a key that differs in a settings folder is put back; only an explicit rotate changes the PC's key", () => {
  const { home, a, b } = pc();
  const key = getOrCreateApiKey(a);
  updateEnvFile(b.envFile, { PC_MCP_API_KEY: "pcmcp_old_one" });
  assert.deepEqual(syncIdentity(b.envFile, home), ["PC_MCP_API_KEY"]);
  assert.equal(envOf(b).PC_MCP_API_KEY, key);

  const fresh = regenerateApiKey(a); // `jarvis mcp rotate --yes` / the dashboard button
  assert.notEqual(fresh, key);
  assert.equal(getOrCreateApiKey(b), fresh); // every settings folder follows the rotation
  assert.equal(readIdentity(home).apiKey, fresh);
});

test("tunnel: the first id stays, another id is ignored, the URL is recorded, and only the user's setting replaces the id", () => {
  const { home, a, b } = pc();
  const restarts: number[] = [];
  applyTunnelUpdate(a.envFile, home, { id: "first.jpe1", url: "" }, () => restarts.push(1));
  applyTunnelUpdate(a.envFile, home, { id: "other.jpe1", url: "https://abc-8765.jpe1.devtunnels.ms/mcp" }, () => restarts.push(1));
  assert.deepEqual(readIdentity(home), { tunnelId: "first.jpe1", publicUrl: "https://abc-8765.jpe1.devtunnels.ms/mcp" });
  assert.equal(restarts.length, 1); // the new URL needs one server restart
  assert.equal(envOf(a).PC_MCP_DEVTUNNEL_ID, "first.jpe1");

  syncIdentity(b.envFile, home); // the other settings folder gets the same tunnel and URL
  assert.equal(envOf(b).PC_MCP_DEVTUNNEL_ID, "first.jpe1");
  assert.equal(envOf(b).PC_MCP_PUBLIC_URL, "https://abc-8765.jpe1.devtunnels.ms/mcp");

  applySettings(a.projectDir, { devtunnel_id: "mine.jpe1" }, a); // the dashboard: the user asked for it
  assert.deepEqual(readIdentity(home), { tunnelId: "mine.jpe1" });
  syncIdentity(b.envFile, home);
  assert.equal(envOf(b).PC_MCP_DEVTUNNEL_ID, "mine.jpe1");
});

test("the identity file is a protected secret", () => {
  const { home, a } = pc();
  assert.equal(protectionOf(a, identityFile(home)), "secret");
});

const req = (port: number, headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method: "GET", path: "/mcp", headers: { connection: "close", ...headers }, agent: false }, (res) => (res.resume(), res.on("end", () => resolve(res.statusCode!))));
    r.on("error", reject);
    r.end();
  });

test("a running server undoes a hand-edited key at once and honours a rotation", async () => {
  const { a } = pc();
  const key = getOrCreateApiKey(a);
  const server = createHttpServer(createCtx(a), key);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    assert.equal(await req(port, { "x-api-key": key }), 405); // authenticated (GET is not served)
    updateEnvFile(a.envFile, { PC_MCP_API_KEY: "pcmcp_edited_by_hand" });
    assert.equal(await req(port, { "x-api-key": "pcmcp_edited_by_hand" }), 401);
    assert.equal(await req(port, { "x-api-key": key }), 405);
    const fresh = regenerateApiKey(a);
    assert.equal(await req(port, { "x-api-key": key }), 401); // the old key is dead after a rotation
    assert.equal(await req(port, { "x-api-key": fresh }), 405);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
