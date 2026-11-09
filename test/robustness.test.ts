import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/core/config.js";
import { createCtx } from "../src/core/context.js";
import { Zip, readXlsx } from "../src/files/docs.js";
import { readBody } from "../src/security/auth.js";
import { createMcpServer } from "../src/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

test("docs robustness: Zip rejects truncated/corrupt buffers and readXlsx prevents OOM on huge column refs", () => {
  // 1. Buffer smaller than 22 bytes
  assert.throws(() => new Zip(Buffer.from("short")), /Not a valid ZIP\/Office file/);

  // 2. Corrupted 30-byte buffer without valid EOCD
  const corrupt = Buffer.alloc(30, 0xaa);
  assert.throws(() => new Zip(corrupt), /Not a valid ZIP\/Office file/);

  // 3. readXlsx with extreme column ref: mock Zip that returns valid sheet XML with ref="ZZZZ1"
  const mockZip = {
    names: () => ["xl/worksheets/sheet1.xml"],
    has: (name: string) => name === "xl/worksheets/sheet1.xml",
    read: (_name: string) => `
      <worksheet>
        <sheetData>
          <row r="1">
            <c r="A1" t="inlineStr"><is><t>Normal Cell</t></is></c>
            <c r="ZZZZ1" t="inlineStr"><is><t>Extreme Cell</t></is></c>
          </row>
        </sheetData>
      </worksheet>
    `,
  } as unknown as Zip;

  const result = readXlsx(mockZip);
  assert.ok(result.includes("Normal Cell"));
  assert.ok(result.includes("Extreme Cell"));
});

test("auth robustness: readBody enforces max size limit and destroys request stream", async () => {
  const server = http.createServer(async (req, res) => {
    try {
      await readBody(req, 16); // 16 bytes max
      res.writeHead(200).end("ok");
    } catch (e) {
      res.writeHead(413).end((e as Error).message);
    }
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  try {
    const postData = "A".repeat(1024); // 1KB exceeds 16 bytes
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port, method: "POST" }, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode!, body: b }));
      });
      r.on("error", () => {
        // Socket may be destroyed when body limit is exceeded, which is expected
        resolve({ status: 413, body: "destroyed" });
      });
      r.write(postData);
      r.end();
    });

    assert.ok(res.status === 413);
  } finally {
    server.close();
  }
});

test("files optimization: search_in_files skips binary files and list_files excludes node_modules in recursive mode", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-opt-")));
  const work = path.join(root, "work");
  fs.mkdirSync(work);

  // 1. Text file with target keyword
  fs.writeFileSync(path.join(work, "app.ts"), 'export const message = "TargetKeywordHere";\n', "utf8");

  // 2. Binary file with leading null byte containing target keyword
  const binaryContent = Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from("TargetKeywordHere in binary")]);
  fs.writeFileSync(path.join(work, "app.bin"), binaryContent);

  // 3. node_modules subfolder with target keyword
  const nmDir = path.join(work, "node_modules", "some-dep");
  fs.mkdirSync(nmDir, { recursive: true });
  fs.writeFileSync(path.join(nmDir, "index.js"), 'console.log("TargetKeywordHere in node_modules");\n', "utf8");

  const cfg = loadConfig({
    projectDir: root,
    dataDir: root,
    home: root,
    env: { PC_MCP_ALLOWED_DIRS: work, PC_MCP_DEFAULT_WORKDIR: work },
  });
  const ctx = createCtx(cfg);

  const mcp = createMcpServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);

  try {
    // Test search_in_files: should only find in app.ts, skipping app.bin (binary) and node_modules
    const searchRes = await client.callTool({
      name: "search_in_files",
      arguments: { query: "TargetKeywordHere", path: work },
    });
    const searchParsed = JSON.parse((searchRes.content[0] as { text: string }).text);
    assert.equal(searchParsed.count, 1);
    assert.equal(searchParsed.matches[0].file, "app.ts");

    // Test list_files recursive: should list app.ts and app.bin, but NOT recurse into node_modules
    const listRes = await client.callTool({
      name: "list_files",
      arguments: { directory: work, recursive: true },
    });
    const listParsed = JSON.parse((listRes.content[0] as { text: string }).text);
    const listedPaths = listParsed.items.map((it: { path: string }) => it.path);
    assert.ok(listedPaths.includes("app.ts"));
    assert.ok(listedPaths.includes("app.bin"));
    assert.ok(!listedPaths.some((p: string) => p.includes("some-dep") || p.includes("index.js")));
  } finally {
    await client.close();
    await mcp.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
