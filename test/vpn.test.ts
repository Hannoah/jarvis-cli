import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/core/config.js";
import { createCtx } from "../src/core/context.js";
import { createMcpServer } from "../src/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getDefaultKubeServer, testTcpConnectivity } from "../src/tools/vpn.js";

test("vpn tools: getDefaultKubeServer parses kubeconfig host and testTcpConnectivity handles ports", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-vpn-test-")));
  const kubeDir = path.join(root, ".kube");
  fs.mkdirSync(kubeDir);

  const sampleKubeConfig = `
apiVersion: v1
clusters:
- cluster:
    server: https://my-corporate-k8s.example.com:8443
  name: test-cluster
contexts: []
current-context: ""
kind: Config
preferences: {}
users: []
  `.trim();
  fs.writeFileSync(path.join(kubeDir, "config"), sampleKubeConfig, "utf8");

  // 1. Parser verification
  const server = getDefaultKubeServer(root);
  assert.ok(server);
  assert.equal(server.host, "my-corporate-k8s.example.com");
  assert.equal(server.port, 8443);

  // 2. testTcpConnectivity with a mock local TCP server
  const mockHttp = http.createServer((_, res) => res.end("ok"));
  await new Promise<void>((r) => mockHttp.listen(0, "127.0.0.1", r));
  const mockPort = (mockHttp.address() as { port: number }).port;

  try {
    const reachable = await testTcpConnectivity("127.0.0.1", mockPort, 1000);
    assert.equal(reachable, true);

    const unreachable = await testTcpConnectivity("127.0.0.1", 1, 500); // port 1 closed
    assert.equal(unreachable, false);
  } finally {
    mockHttp.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("vpn tools via MCP: check_vpn_status returns structured status and vpn_keepalive starts/stops", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-vpn-mcp-")));
  const cfg = loadConfig({ projectDir: root, dataDir: root, home: root, env: {} });
  const ctx = createCtx(cfg);

  const mcp = createMcpServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  const client = new Client({ name: "vpn-test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);

  try {
    // 1. check_vpn_status
    const statusRes = await client.callTool({
      name: "check_vpn_status",
      arguments: {},
    });
    assert.ok(statusRes.content[0]);
    const parsedStatus = JSON.parse((statusRes.content[0] as { text: string }).text);
    assert.ok("connected" in parsedStatus);
    assert.ok("adapter_status" in parsedStatus);
    assert.ok("service_status" in parsedStatus);
    assert.ok("k8s_target" in parsedStatus);
    assert.ok("k8s_reachable" in parsedStatus);
    assert.ok("message" in parsedStatus);

    // 2. vpn_keepalive status
    const initialKeep = await client.callTool({
      name: "vpn_keepalive",
      arguments: { action: "status" },
    });
    const parsedInitial = JSON.parse((initialKeep.content[0] as { text: string }).text);
    assert.equal(parsedInitial.success, true);
    assert.equal(parsedInitial.state.active, false);

    // 3. vpn_keepalive start
    const startKeep = await client.callTool({
      name: "vpn_keepalive",
      arguments: { action: "start", interval_sec: 60 },
    });
    const parsedStart = JSON.parse((startKeep.content[0] as { text: string }).text);
    assert.equal(parsedStart.success, true);
    assert.equal(parsedStart.state.active, true);
    assert.ok(parsedStart.state.total_pings >= 1);

    // 4. vpn_keepalive stop
    const stopKeep = await client.callTool({
      name: "vpn_keepalive",
      arguments: { action: "stop" },
    });
    const parsedStop = JSON.parse((stopKeep.content[0] as { text: string }).text);
    assert.equal(parsedStop.success, true);
    assert.equal(parsedStop.state.active, false);
  } finally {
    await client.close();
    await mcp.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
