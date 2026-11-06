import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDashboard } from "../src/supervisor/dashboard.js";
import { renderUi } from "../src/supervisor/ui.js";

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; json: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          host: `${u.hostname}:${u.port}`,
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          let j = null;
          try {
            j = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode ?? 0, body: text, json: j });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("dashboard: UI contains agents tab and GET /api/agents returns summarised agent activity", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-dash-test-"));
  const token = "test-token-12345";

  // Pre-seed an audit.log with agent entries
  const auditFile = path.join(tmp, "audit.log");
  fs.writeFileSync(
    auditFile,
    `[2026-11-06 14:00:00] [AGENT] [mcp] agent="copilot-studio" ver="1.2.0" via=tunnel rpc=initialize\n` +
    `[2026-11-06 14:00:05] [AGENT] [mcp] agent="copilot-studio" ver="1.2.0" via=tunnel rpc=tools/call tool="read_file"\n` +
    `[2026-11-06 14:01:00] [AGENT] [mcp] agent="copilot-studio" ver="1.2.0" via=tunnel rpc=tools/call tool="git_status"\n`
  );

  // Setup minimal config file so cfgNow() doesn't fail
  fs.writeFileSync(
    path.join(tmp, "config.json"),
    JSON.stringify({ allowed_dirs: [tmp] })
  );

  // Check UI rendering directly
  const html = renderUi("0.10.0");
  assert.ok(html.includes('id="nav-agents"'), "UI should have nav-agents button");
  assert.ok(html.includes('id="tab-agents"'), "UI should have tab-agents section");

  // Reserve a free port
  const reserver = net.createServer();
  await new Promise<void>((r) => reserver.listen(0, "127.0.0.1", () => r()));
  const dashPort = (reserver.address() as { port: number }).port;
  await new Promise<void>((r) => reserver.close(() => r()));

  const fakeSvc = {
    state: "stopped",
    status: () => ({ state: "stopped", restarts_in_window: 0, total_restarts: 0, pid: null, started_at: null, last_exit: null, message: "" }),
  } as any;
  const fakeTunnel = {
    state: "off",
    snapshot: () => ({ state: "off", message: "", id: "", url: "", service: null }),
  } as any;

  const srv = createDashboard({
    projectDir: tmp,
    version: "0.10.0",
    token,
    port: dashPort,
    server: fakeSvc,
    tunnel: fakeTunnel,
    log: () => {},
  });

  await new Promise<void>((r) => srv.listen(dashPort, "127.0.0.1", () => r()));

  try {
    const base = `http://127.0.0.1:${dashPort}`;

    // 1. Unauthenticated request to /api/agents should be 401
    const unauth = await get(`${base}/api/agents`);
    assert.equal(unauth.status, 401);

    // 2. Authenticated request with x-jarvis-token header
    const authRes = await get(`${base}/api/agents`, {
      "x-jarvis-token": token,
    });
    assert.equal(authRes.status, 200);
    assert.ok(authRes.json && Array.isArray(authRes.json.agents));
    assert.equal(authRes.json.agents.length, 1);

    const copilot = authRes.json.agents[0];
    assert.equal(copilot.agent, "copilot-studio");
    assert.equal(copilot.version, "1.2.0");
    assert.deepEqual(copilot.via, ["tunnel"]);
    assert.equal(copilot.calls, 2);
    assert.equal(copilot.tools.read_file, 1);
    assert.equal(copilot.tools.git_status, 1);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
