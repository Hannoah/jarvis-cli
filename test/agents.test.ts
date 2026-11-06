import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fields, parseAudit, parseDuration, summarizeAgents } from "../src/auditView.js";
import { loadConfig } from "../src/core/config.js";
import { createCtx } from "../src/core/context.js";
import { agentDetails, rpcsOf } from "../src/server/agents.js";
import { createHttpServer } from "../src/server/http.js";

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "Test Agent", version: "1.2" } } };
const CALL = (name: string) => ({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: {} } });

test("rpcsOf reads initialize clientInfo and tools/call names, singly or batched", () => {
  assert.deepEqual(rpcsOf(INIT), [{ method: "initialize", client: { name: "Test Agent", version: "1.2" } }]);
  assert.deepEqual(rpcsOf([CALL("read_file"), { jsonrpc: "2.0", method: "notifications/initialized" }, "junk"]), [{ method: "tools/call", tool: "read_file" }, { method: "notifications/initialized" }]);
  assert.deepEqual(rpcsOf(null), []);
});

test("agent audit lines are one line each, whatever the client sends, and tools/call inherits the name from initialize", () => {
  const who = { ua: "ua-unit", ip: "203.0.113.5", via: "tunnel" as const };
  const lines = agentDetails([...rpcsOf(INIT), ...rpcsOf(CALL('evil"\nname'))], who);
  assert.equal(lines.length, 2);
  for (const l of lines) assert.ok(!/[\r\n]/.test(l));
  const f = fields(lines[1]!);
  assert.equal(f.agent, "Test Agent");
  assert.equal(f.tool, 'evil"\nname'); // survives the round trip, quoted
  assert.equal(f.via, "tunnel");
});

const LOG = `[2026-11-06 09:00:00] [AGENT] [mcp] agent="Claude Code" ver="2.1" ua="claude-code/2.1" via=tunnel ip="1.2.3.4" rpc=initialize
[2026-11-06 09:00:05] [AGENT] [mcp] agent="Claude Code" ver="2.1" ua="claude-code/2.1" via=tunnel ip="1.2.3.4" rpc=tools/call tool="read_file"
[2026-11-06 09:00:09] [AGENT] [mcp] agent="Claude Code" ver="2.1" ua="claude-code/2.1" via=tunnel ip="1.2.3.4" rpc=tools/call tool="read_file"
[2026-11-06 09:00:10] [ALLOW] [read_file] C:\\x
[2026-11-06 10:00:00] [AGENT] [cli] agent="my-agent" ua="jarvis-cli/0.8.0" via=cli ip="local" rpc=tools/call tool="git_status"
[2026-11-06 10:05:00] [AGENT] [mcp] ua="curl/8" via=local ip="127.0.0.1" rpc=tools/call tool="get_pc_env"
`;

test("agents are summarised from the audit log: by announced name, else user-agent; counts, tools, last seen", () => {
  const rows = summarizeAgents(parseAudit(LOG));
  assert.deepEqual(rows.map((r) => r.agent), ["curl/8", "my-agent", "Claude Code"]); // latest first
  const cc = rows.find((r) => r.agent === "Claude Code")!;
  assert.equal(cc.calls, 2);
  assert.equal(cc.connects, 1);
  assert.deepEqual(cc.tools, { read_file: 2 });
  assert.deepEqual(cc.via, ["tunnel"]);
  assert.equal(cc.version, "2.1");
  assert.equal(summarizeAgents(parseAudit(LOG), new Date(2026, 10, 6, 9, 30).getTime()).length, 2); // --since
  assert.equal(parseDuration("2h"), 7_200_000);
  assert.equal(parseDuration("soon"), null);
});

test("over HTTP: initialize and tools/call are attributed to the agent; the tunnel is told apart from a local client", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-ag-")));
  fs.mkdirSync(path.join(root, "data"));
  const cfg = loadConfig({ projectDir: root, dataDir: path.join(root, "data"), home: root, env: {} });
  const logged: string[] = [];
  const server = createHttpServer(createCtx(cfg, (tool, status, detail) => logged.push(`[${status}] [${tool}] ${detail}`)), "pcmcp_agents_test_key");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const post = (body: unknown, extra: Record<string, string> = {}) =>
    new Promise<number>((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port, method: "POST", path: "/mcp", agent: false, headers: { connection: "close", "content-type": "application/json", accept: "application/json, text/event-stream", "x-api-key": "pcmcp_agents_test_key", "user-agent": "agent-ua/1", ...extra } }, (res) => (res.resume(), res.on("end", () => resolve(res.statusCode!))));
      r.on("error", reject);
      r.end(JSON.stringify(body));
    });
  try {
    assert.equal(await post(INIT), 200);
    assert.equal(await post(CALL("get_pc_env")), 200);
    assert.equal(await post(CALL("get_pc_env"), { "x-forwarded-host": "abc.devtunnels.ms", "x-forwarded-for": "198.51.100.7" }), 200);
    assert.equal(await post("{bad json".slice(0, 0) as unknown), 400); // an empty body is a parse error, not a hang
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  const agentLines = logged.filter((l) => l.startsWith("[AGENT] [mcp]"));
  assert.equal(agentLines.length, 3);
  assert.match(agentLines[0]!, /agent="Test Agent" ver="1.2" ua="agent-ua\/1" via=local .*rpc=initialize/);
  assert.match(agentLines[1]!, /agent="Test Agent" .*via=local .*rpc=tools\/call tool="get_pc_env"/);
  assert.match(agentLines[2]!, /via=tunnel ip="198.51.100.7" rpc=tools\/call tool="get_pc_env"/);
  assert.ok(logged.some((l) => l.startsWith("[ALLOW] [get_pc_env]"))); // the tool's own audit line is still there
});

test("CLI for agents: list --json carries the parameter schemas, --format json is one line, JARVIS_AGENT is recorded and shown by `agents`", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-cli-")));
  const data = path.join(root, "data");
  const work = path.join(root, "work");
  fs.mkdirSync(data);
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(data, ".env"), `PC_MCP_ALLOWED_DIRS=${work}\nPC_MCP_DEFAULT_WORKDIR=${work}\n`);
  fs.writeFileSync(path.join(work, "hello.txt"), "hi there\n");
  const jarvis = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), path.join(import.meta.dirname, "..", "src", "cli.ts"), ...args], { encoding: "utf8", cwd: work, env: { ...process.env, JARVIS_HOME: data, JARVIS_NO_UPDATE_CHECK: "1", CLAUDECODE: "", JARVIS_AGENT: "", ...env } });

  const tools = JSON.parse(jarvis(["list", "--json"]).stdout) as { name: string; inputSchema: { required?: string[] } }[];
  assert.ok(tools.length >= 30);
  assert.deepEqual(tools.find((t) => t.name === "read_file")!.inputSchema.required, ["path"]);
  const help = JSON.parse(jarvis(["help", "read_file", "--format", "json"]).stdout) as { name: string; inputSchema: unknown };
  assert.equal(help.name, "read_file");
  assert.ok(help.inputSchema);

  const ok = jarvis(["read_file", "hello.txt", "--format", "json"], { JARVIS_AGENT: "my-agent" });
  assert.equal(ok.status, 0);
  const out = JSON.parse(ok.stdout.trim()) as { ok: boolean; tool: string; exit_code: number; result: { content: string } };
  assert.deepEqual([out.ok, out.tool, out.exit_code, out.result.content], [true, "read_file", 0, "hi there"]);

  const bad = jarvis(["read_file", "missing.txt", "--format", "json"], { JARVIS_AGENT: "my-agent" });
  assert.equal(bad.status, 1);
  assert.equal((JSON.parse(bad.stdout.trim()) as { ok: boolean }).ok, false);

  const missing = jarvis(["read_file", "--format", "json"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /Missing required: path/);

  const agents = JSON.parse(jarvis(["agents", "--json"]).stdout) as { agent: string; calls: number; via: string[]; tools: Record<string, number> }[];
  assert.equal(agents.length, 1);
  assert.deepEqual([agents[0]!.agent, agents[0]!.calls, agents[0]!.via, agents[0]!.tools], ["my-agent", 2, ["cli"], { read_file: 2 }]);

  const audit = JSON.parse(jarvis(["audit", "--agent", "my-agent", "--json"]).stdout) as { status: string }[];
  assert.equal(audit.length, 2);
  assert.ok(jarvis(["about"]).stdout.includes("Jarvis"));
});
