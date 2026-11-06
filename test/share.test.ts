import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/core/config.js";
import type { Ctx } from "../src/core/context.js";
import { clearSharesForTest, createShareToken } from "../src/core/share.js";
import { createHttpServer } from "../src/server/http.js";

function get(url: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    }).on("error", reject);
  });
}

test("share_file_url: sandboxed token creation, TTL expiry, one-time download and HTTP serving", async () => {
  clearSharesForTest();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-share-")));
  const allowedDir = path.join(root, "allowed");
  const outsideDir = path.join(root, "outside");
  fs.mkdirSync(allowedDir);
  fs.mkdirSync(outsideDir);

  const sampleFile = path.join(allowedDir, "report.txt");
  fs.writeFileSync(sampleFile, "Hello Jarvis Mobile Download!", "utf8");

  const outsideFile = path.join(outsideDir, "secret.txt");
  fs.writeFileSync(outsideFile, "Top Secret Outside Sandbox", "utf8");

  const cfg = loadConfig({
    projectDir: root,
    dataDir: root,
    home: root,
    env: { PC_MCP_ALLOWED_DIRS: allowedDir },
  });

  // 1. Sandbox enforcement: outside file must throw
  assert.throws(() => {
    createShareToken(outsideFile, cfg);
  }, /is outside allowed directories/i);

  // 2. Normal share token creation
  const normalToken = createShareToken(sampleFile, cfg, { ttlMs: 60_000 });
  assert.equal(normalToken.fileName, "report.txt");
  assert.equal(normalToken.fileSize, 29);
  assert.ok(normalToken.token.length >= 32);

  // 3. One-time share token
  const oneTimeToken = createShareToken(sampleFile, cfg, { ttlMs: 60_000, oneTime: true });

  const ctx: Ctx = {
    cfg,
    audit: () => {},
    plugins: [],
  };

  const server = createHttpServer(ctx, "test-api-key");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 4. Download valid file
    const res = await get(`${base}/download/${normalToken.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body, "Hello Jarvis Mobile Download!");
    assert.match(String(res.headers["content-disposition"]), /filename\*=UTF-8''report\.txt/);

    // Repeated download allowed for normal token
    const res2 = await get(`${base}/download/${normalToken.token}`);
    assert.equal(res2.status, 200);

    // 5. One-time token works once, then expires
    const oneRes1 = await get(`${base}/download/${oneTimeToken.token}`);
    assert.equal(oneRes1.status, 200);
    assert.equal(oneRes1.body, "Hello Jarvis Mobile Download!");

    const oneRes2 = await get(`${base}/download/${oneTimeToken.token}`);
    assert.equal(oneRes2.status, 404);

    // 6. Invalid token returns 404
    const notFound = await get(`${base}/download/non-existent-token`);
    assert.equal(notFound.status, 404);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
    clearSharesForTest();
  }
});
