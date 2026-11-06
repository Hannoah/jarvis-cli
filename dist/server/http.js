import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAuth } from "../security/auth.js";
import { isLoopbackIp, normalizeIp, RateLimiter } from "../security/ratelimit.js";
import { createMcpServer } from "./mcp.js";
// ponytail: stateless (new transport per request), so no session store to leak or expire.
export function createHttpServer(ctx, apiKey, limiter = new RateLimiter()) {
    const auth = createAuth(ctx.cfg, ctx.audit, apiKey);
    const server = createServer(async (req, res) => {
        try {
            const peer = req.socket.remoteAddress ?? "";
            if (peer && !isLoopbackIp(peer)) {
                const v = limiter.take(normalizeIp(peer));
                if (!v.allowed) {
                    if (v.audit)
                        ctx.audit("http", "RATE_429", `Rate limit exceeded for ${normalizeIp(peer)}`);
                    res.writeHead(429, { "content-type": "application/json", "retry-after": String(v.retryAfterSec) });
                    res.end(JSON.stringify({ error: "Too many requests" }));
                    return;
                }
            }
            if (await auth.handle(req, res))
                return;
            if (new URL(req.url ?? "/", "http://x").pathname !== "/mcp") {
                res.writeHead(404).end();
                return;
            }
            if (req.method !== "POST") {
                res.writeHead(405, { Allow: "POST" }).end();
                return;
            }
            const mcp = createMcpServer(ctx);
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
            res.on("close", () => {
                void transport.close();
                void mcp.close();
            });
            await mcp.connect(transport);
            await transport.handleRequest(req, res);
        }
        catch (err) {
            console.error("request failed:", err);
            if (!res.headersSent)
                res.writeHead(500).end();
        }
    });
    // Slow-loris guard for the header phase. The body/response phase is deliberately unbounded:
    // legitimate tool calls (terminal, git, documents) can run for minutes.
    server.headersTimeout = 30_000;
    return server;
}
