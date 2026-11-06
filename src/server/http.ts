import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAuth, readBody } from "../security/auth.js";
import { isLoopbackIp, normalizeIp, RateLimiter } from "../security/ratelimit.js";
import type { Ctx } from "../core/context.js";
import { agentDetails, rpcsOf } from "./agents.js";
import { createMcpServer } from "./mcp.js";

const MAX_RPC_BODY = 4 * 1024 * 1024;
const rpcError = (res: import("node:http").ServerResponse, status: number, code: number, message: string) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
};

/**
 * What to rate-limit by, or null for a genuinely local client. The Dev Tunnel connects from this machine, so tunnel
 * traffic arrives from a loopback address too; only the forwarding headers the tunnel adds tell it apart from a local MCP
 * client. All tunnel callers share one bucket (ponytail: per-client buckets would need a trusted X-Forwarded-For).
 */
export function limitKey(peer: string, headers: IncomingHttpHeaders): string | null {
  if (!peer) return null;
  if (!isLoopbackIp(peer)) return normalizeIp(peer);
  return ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"].some((h) => headers[h]) ? "tunnel" : null;
}

// ponytail: stateless (new transport per request), so no session store to leak or expire.
export function createHttpServer(ctx: Ctx, apiKey: string, limiter: RateLimiter = new RateLimiter()): Server {
  const auth = createAuth(ctx.cfg, ctx.audit, apiKey);
  const server = createServer(async (req, res) => {
    try {
      const peer = req.socket.remoteAddress ?? "";
      const key = limitKey(peer, req.headers);
      if (key) {
        const v = limiter.take(key);
        if (!v.allowed) {
          if (v.audit) ctx.audit("http", "RATE_429", `Rate limit exceeded for ${key}`);
          res.writeHead(429, { "content-type": "application/json", "retry-after": String(v.retryAfterSec) });
          res.end(JSON.stringify({ error: "Too many requests" }));
          return;
        }
      }
      if (await auth.handle(req, res)) return;
      if (new URL(req.url ?? "/", "http://x").pathname !== "/mcp") {
        res.writeHead(404).end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST" }).end();
        return;
      }
      // Read the JSON-RPC body here (the transport accepts it pre-parsed) so the audit log can say which agent is calling.
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, MAX_RPC_BODY));
      } catch (e) {
        return void ((e as Error).message === "body too large" ? rpcError(res, 413, -32600, "Request too large") : rpcError(res, 400, -32700, "Parse error"));
      }
      const ua = String(req.headers["user-agent"] ?? "").trim();
      const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim() || normalizeIp(peer);
      const via = key === "tunnel" ? "tunnel" : isLoopbackIp(peer) ? "local" : "remote";
      for (const d of agentDetails(rpcsOf(body), { ua, ip, via })) ctx.audit("mcp", "AGENT", d);

      const mcp = createMcpServer(ctx);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("request failed:", err);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
  // Slow-loris guard for the header phase. The body/response phase is deliberately unbounded:
  // legitimate tool calls (terminal, git, documents) can run for minutes.
  server.headersTimeout = 30_000;
  return server;
}
