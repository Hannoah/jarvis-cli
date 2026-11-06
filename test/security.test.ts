import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/core/config.js";
import { createCtx } from "../src/core/context.js";
import { RateLimiter } from "../src/security/ratelimit.js";
import { checkCommand, CommandPolicyError, psExecutable } from "../src/security/policy.js";
import { createHttpServer, limitKey } from "../src/server/http.js";
import { resolveSafePath, SandboxViolationError } from "../src/tools/common.js";
import { which } from "../src/system/cliEnv.js";

function setup() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-sec-")));
  const work = path.join(root, "work");
  const data = path.join(root, "data");
  fs.mkdirSync(work);
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, ".env"), `PC_MCP_ALLOWED_DIRS=${work};${data}\nPC_MCP_DEFAULT_WORKDIR=${work}\n`);
  const cfg = loadConfig({ projectDir: root, dataDir: data, env: {}, home: root });
  return { root, work, data, cfg, ctx: createCtx(cfg) };
}

test("sandbox: inside is fine; outside, traversal, secrets and (for writes) server state are refused", () => {
  const { work, data, ctx } = setup();
  assert.equal(resolveSafePath(ctx, path.join(work, "a.txt"), "t"), path.join(work, "a.txt"));
  assert.throws(() => resolveSafePath(ctx, path.join(work, "..", "elsewhere"), "t"), SandboxViolationError);
  assert.throws(() => resolveSafePath(ctx, path.join(data, ".env"), "t"), SandboxViolationError); // secret: not even readable
  assert.throws(() => resolveSafePath(ctx, path.join(data, ".oauth_tokens.json"), "t"), SandboxViolationError);
  assert.equal(resolveSafePath(ctx, path.join(data, "audit.log"), "t", "read"), path.join(data, "audit.log"));
  assert.throws(() => resolveSafePath(ctx, path.join(data, "audit.log"), "t", "write"), SandboxViolationError);
  assert.throws(() => resolveSafePath(ctx, path.join(data, "custom_tools", "x.mjs"), "t", "write"), SandboxViolationError); // plugins live in the data folder
});

test("rate limit: local clients are exempt, tunnel traffic (loopback + forwarding headers) and remote peers are not", () => {
  assert.equal(limitKey("127.0.0.1", {}), null);
  assert.equal(limitKey("::ffff:127.0.0.1", {}), null);
  assert.equal(limitKey("::1", { "x-forwarded-host": "abc.devtunnels.ms" }), "tunnel");
  assert.equal(limitKey("127.0.0.1", { "x-forwarded-for": "203.0.113.9" }), "tunnel");
  assert.equal(limitKey("::ffff:203.0.113.9", {}), "203.0.113.9");
  const l = new RateLimiter({ max: 2 });
  assert.deepEqual([1, 2, 3].map(() => l.take("tunnel").allowed), [true, true, false]);
});

const req = (port: number, method: string, urlPath: string, headers: Record<string, string> = {}, body = "") =>
  new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers: { connection: "close", ...headers }, agent: false }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: b }));
    });
    r.on("error", reject);
    r.end(body);
  });

async function serve(limiter?: RateLimiter) {
  const { ctx } = setup();
  const key = "pcmcp_test_key_0123456789";
  const server = createHttpServer(ctx, key, limiter);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { key, port: (server.address() as { port: number }).port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("http: health is open, /mcp needs the key or an OAuth token, wrong keys are refused", async () => {
  const s = await serve();
  try {
    assert.equal((await req(s.port, "GET", "/health")).status, 200);
    assert.equal((await req(s.port, "GET", "/mcp")).status, 401);
    assert.equal((await req(s.port, "GET", "/mcp", { "x-api-key": "wrong" })).status, 401);
    assert.equal((await req(s.port, "GET", "/mcp", { authorization: `Bearer ${s.key}` })).status, 405); // authenticated: only POST is served
    assert.equal((await req(s.port, "GET", "/nope", { "x-api-key": s.key })).status, 404);
  } finally {
    await s.close();
  }
});

test("oauth: consent needs the API key, PKCE is enforced, and the issued token works", async () => {
  const s = await serve();
  try {
    const verifier = "v".repeat(50);
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
    const post = { "content-type": "application/x-www-form-urlencoded" };
    const authz = { redirect_uri: "https://client.example/cb", code_challenge: challenge, code_challenge_method: "S256", state: "s1" };

    assert.equal((await req(s.port, "POST", "/oauth/authorize", post, form({ ...authz, api_key: "wrong" }))).status, 401);
    const ok = await req(s.port, "POST", "/oauth/authorize", post, form({ ...authz, api_key: s.key }));
    assert.equal(ok.status, 302);
    const loc = new URL(ok.headers.location!);
    assert.equal(loc.searchParams.get("state"), "s1");
    const code = loc.searchParams.get("code")!;

    const bad = await req(s.port, "POST", "/oauth/token", post, form({ grant_type: "authorization_code", code, code_verifier: "x".repeat(50) }));
    assert.equal(bad.status, 400); // wrong verifier
    const good = await req(s.port, "POST", "/oauth/token", post, form({ grant_type: "authorization_code", code, code_verifier: verifier }));
    assert.equal(good.status, 200);
    const tok = JSON.parse(good.body).access_token as string;
    assert.equal((await req(s.port, "GET", "/mcp", { authorization: `Bearer ${tok}` })).status, 405);
    assert.equal((await req(s.port, "GET", "/mcp", { authorization: "Bearer mcp_at_forged" })).status, 401);
    const again = await req(s.port, "POST", "/oauth/token", post, form({ grant_type: "authorization_code", code, code_verifier: verifier }));
    assert.equal(again.status, 400); // codes are single use
  } finally {
    await s.close();
  }
});

test("http: tunnel requests are rate limited even though they come from loopback; local ones are not", async () => {
  const s = await serve(new RateLimiter({ max: 2 }));
  try {
    const tunneled = { "x-forwarded-host": "abc.devtunnels.ms", "x-forwarded-proto": "https" };
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await req(s.port, "GET", "/health", tunneled)).status);
    assert.deepEqual(codes, [200, 200, 429, 429]);
    for (let i = 0; i < 5; i++) assert.equal((await req(s.port, "GET", "/health")).status, 200);
  } finally {
    await s.close();
  }
});

// The command policy asks PowerShell itself to parse the command, so these need powershell (Windows) or pwsh.
const hasPs = !!which([psExecutable()], process.env);
test("command policy: allowlisted commands pass; dynamic, unlisted, outside-sandbox and secret access are refused", { skip: !hasPs && "PowerShell not installed" }, async () => {
  const { work, data, cfg } = setup();
  const deps = { isAllowed: (p: string) => [work, data].some((d) => path.relative(d, p) === "" || !path.relative(d, p).startsWith("..")), isProtected: () => false, isSecret: (p: string) => p === path.join(data, ".env"), home: cfg.home };
  const ok = (cmd: string) => checkCommand(cmd, work, deps);
  const denied = (cmd: string, re: RegExp) => assert.rejects(ok(cmd), (e: Error) => e instanceof CommandPolicyError && re.test(e.message), cmd);

  await ok("git status");
  await ok("Get-ChildItem | Select-Object Name");
  await ok(`Set-Content -Path '${path.join(work, "a.txt")}' -Value hi`);
  await denied("calc.exe", /not on the allowlist/);
  await denied("Invoke-Expression 'git status'", /not on the allowlist/);
  await denied("& $x", /Dynamic command invocation|parse|not allowed/i);
  await denied(`Remove-Item '${path.join(work, "..", "x")}'`, /outside allowed/);
  await denied(`Get-Content '${path.join(data, ".env")}'`, /secret/);
  await denied("Remove-Item $env:TEMP\\x", /only accepts literal/);
  await denied("[System.IO.File]::Delete('x')", /Static .NET call not allowed/);
  await denied("git status; Write-Output (1+", /parse error/i);
});

test("enrichEnv: tool settings come from the settings file, other keys (the API key) do not", async () => {
  const { enrichEnv } = await import("../src/system/cliEnv.js");
  const out = enrichEnv({ KUBECONFIG: "from-env" }, os.tmpdir(), { KUBECONFIG: " from-file ", VIYA_CLI_DIR: "X", PC_MCP_API_KEY: "secret" });
  assert.equal(out.KUBECONFIG, "from-file"); // the settings file wins, like every other setting
  assert.equal(out.VIYA_CLI_DIR, "X");
  assert.equal(out.PC_MCP_API_KEY, undefined);
});
