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
import {
  getDefaultKubeServer,
  parseTargetEndpoint,
  resetKeepAliveForTest,
  testTcpConnectivity,
} from "../src/tools/vpn.js";

test("vpn tools: parseTargetEndpoint handles various URL and host:port combinations", () => {
  // Plain host
  const ep1 = parseTargetEndpoint("viya.example.com");
  assert.equal(ep1.host, "viya.example.com");
  assert.equal(ep1.port, 443);

  // Host with port
  const ep2 = parseTargetEndpoint("viya.example.com:8443");
  assert.equal(ep2.host, "viya.example.com");
  assert.equal(ep2.port, 8443);

  // Full https URL with port and trailing path
  const ep3 = parseTargetEndpoint("https://k8s.internal.net:6443/api/v1");
  assert.equal(ep3.host, "k8s.internal.net");
  assert.equal(ep3.port, 6443);

  // Http URL without port
  const ep4 = parseTargetEndpoint("http://test.local/");
  assert.equal(ep4.host, "test.local");
  assert.equal(ep4.port, 443);
});

test("vpn tools: getDefaultKubeServer parses kubeconfig host, handles fallbacks, and testTcpConnectivity handles ports", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-vpn-test-")));
  const kubeDir = path.join(root, ".kube");
  fs.mkdirSync(kubeDir);

  // Missing config returns null
  assert.equal(getDefaultKubeServer(path.join(root, "non-existent-dir")), null);

  // Valid config with explicit port
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

  const server = getDefaultKubeServer(root);
  assert.ok(server);
  assert.equal(server.host, "my-corporate-k8s.example.com");
  assert.equal(server.port, 8443);

  // Config without explicit port (default to 443)
  fs.writeFileSync(
    path.join(kubeDir, "config"),
    `clusters: [{ cluster: { server: "https://k8s-noport.example.com" } }]`,
    "utf8",
  );
  const serverNoPort = getDefaultKubeServer(root);
  assert.ok(serverNoPort);
  assert.equal(serverNoPort.host, "k8s-noport.example.com");
  assert.equal(serverNoPort.port, 443);

  // Corrupted config without server returns null
  fs.writeFileSync(path.join(kubeDir, "config"), "invalid: content", "utf8");
  assert.equal(getDefaultKubeServer(root), null);

  // 2. testTcpConnectivity with a mock local TCP server
  const mockHttp = http.createServer((_, res) => res.end("ok"));
  await new Promise<void>((r) => mockHttp.listen(0, "127.0.0.1", r));
  const mockPort = (mockHttp.address() as { port: number }).port;

  try {
    const reachable = await testTcpConnectivity("127.0.0.1", mockPort, 1000);
    assert.equal(reachable, true);

    const unreachable = await testTcpConnectivity("127.0.0.1", 1, 300); // port 1 closed
    assert.equal(unreachable, false);

    // Watchdog / unresolvable address
    const nonExistent = await testTcpConnectivity("invalid-nonexistent-domain-12345.local", 443, 300);
    assert.equal(nonExistent, false);
  } finally {
    mockHttp.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("vpn tools via MCP: check_vpn_status returns structured status and vpn_keepalive starts/stops", async () => {
  resetKeepAliveForTest();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-vpn-mcp-")));
  const cfg = loadConfig({ projectDir: root, dataDir: root, home: root, env: {} });
  const ctx = createCtx(cfg);

  const mcp = createMcpServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  const client = new Client({ name: "vpn-test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);

  try {
    // 1. check_vpn_status with custom target_host
    const statusRes = await client.callTool({
      name: "check_vpn_status",
      arguments: { target_host: "127.0.0.1", target_port: 65534 },
    });
    assert.ok(statusRes.content[0]);
    const parsedStatus = JSON.parse((statusRes.content[0] as { text: string }).text);
    assert.ok("connected" in parsedStatus);
    assert.ok("adapter_status" in parsedStatus);
    assert.ok("service_status" in parsedStatus);
    assert.equal(parsedStatus.k8s_target, "127.0.0.1:65534");
    assert.equal(parsedStatus.k8s_reachable, false);
    assert.ok("message" in parsedStatus);

    // 2. vpn_keepalive status initial
    const initialKeep = await client.callTool({
      name: "vpn_keepalive",
      arguments: { action: "status" },
    });
    const parsedInitial = JSON.parse((initialKeep.content[0] as { text: string }).text);
    assert.equal(parsedInitial.success, true);
    assert.equal(parsedInitial.state.active, false);

    // 3. vpn_keepalive start with URL string in target_host
    const startKeep = await client.callTool({
      name: "vpn_keepalive",
      arguments: {
        action: "start",
        interval_sec: 60,
        target_host: "https://127.0.0.1:65534/test",
      },
    });
    const parsedStart = JSON.parse((startKeep.content[0] as { text: string }).text);
    assert.equal(parsedStart.success, true);
    assert.equal(parsedStart.state.active, true);
    assert.equal(parsedStart.state.target, "127.0.0.1:65534");
    assert.ok(parsedStart.state.total_pings >= 1);

    // 4. vpn_keepalive start again (re-starting updates target/resets timer safely)
    const restartKeep = await client.callTool({
      name: "vpn_keepalive",
      arguments: {
        action: "start",
        interval_sec: 120,
        target_host: "127.0.0.1",
        target_port: 8080,
      },
    });
    const parsedRestart = JSON.parse((restartKeep.content[0] as { text: string }).text);
    assert.equal(parsedRestart.success, true);
    assert.equal(parsedRestart.state.active, true);
    assert.equal(parsedRestart.state.target, "127.0.0.1:8080");

    // 5. vpn_keepalive stop
    const stopKeep = await client.callTool({
      name: "vpn_keepalive",
      arguments: { action: "stop" },
    });
    const parsedStop = JSON.parse((stopKeep.content[0] as { text: string }).text);
    assert.equal(parsedStop.success, true);
    assert.equal(parsedStop.state.active, false);

    // 6. vpn_keepalive stop redundant call (should remain safe and false)
    const stopAgain = await client.callTool({
      name: "vpn_keepalive",
      arguments: { action: "stop" },
    });
    const parsedStopAgain = JSON.parse((stopAgain.content[0] as { text: string }).text);
    assert.equal(parsedStopAgain.success, true);
    assert.equal(parsedStopAgain.state.active, false);
  } finally {
    resetKeepAliveForTest();
    await client.close();
    await mcp.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
