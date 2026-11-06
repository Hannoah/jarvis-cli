/**
 * Per-IP rate limiting for the internet-exposed MCP endpoint.
 *
 * The tunnel URL is public: scanners and login-probers will find it. The API key itself is
 * unguessable, but without a limit every probe costs a full request (audit write included), so a
 * flood both burns CPU and churns the log. This is a fixed-window counter per client IP with lazy
 * expiry: cheap (one Map lookup per request), dependency-free, and precise enough for abuse
 * mitigation. Loopback callers (local MCP clients, the dashboard's tool list, health probes) are
 * exempt by the caller, not here, so tests can exercise the limiter with any address.
 */
export interface RateLimiterOptions {
  /** Requests allowed per IP per window. Default 300/min: generous for any paced MCP client. */
  max?: number;
  /** Window length in ms. Default 60_000. */
  windowMs?: number;
  /** Cap on tracked IPs (each entry dies with its window anyway). Default 10_000. */
  maxIps?: number;
  /** Clock override for tests. */
  now?: () => number;
}

export interface Verdict {
  allowed: boolean;
  /** True only for the first rejection in a window: audit that one, drop the rest silently. */
  audit: boolean;
  /** Seconds the client should wait before retrying (for the Retry-After header). */
  retryAfterSec: number;
}

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxIps: number;
  private readonly now: () => number;

  constructor(opts: RateLimiterOptions = {}) {
    this.max = opts.max ?? 300;
    this.windowMs = opts.windowMs ?? 60_000;
    this.maxIps = opts.maxIps ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  take(ip: string): Verdict {
    const t = this.now();
    let e = this.hits.get(ip);
    if (!e || t >= e.resetAt) {
      e = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(ip, e);
      if (this.hits.size > this.maxIps) this.prune(t);
    }
    e.count++;
    if (e.count <= this.max) return { allowed: true, audit: false, retryAfterSec: 0 };
    return {
      allowed: false,
      audit: e.count === this.max + 1,
      retryAfterSec: Math.max(1, Math.ceil((e.resetAt - t) / 1000)),
    };
  }

  /** For tests and (later) observability. */
  get size(): number {
    return this.hits.size;
  }

  private prune(t: number): void {
    for (const [ip, e] of this.hits) {
      if (e.resetAt <= t) this.hits.delete(ip);
      if (this.hits.size <= this.maxIps) return;
    }
    // No expired entries (a real flood of distinct IPs): drop the oldest windows first.
    for (const ip of this.hits.keys()) {
      this.hits.delete(ip);
      if (this.hits.size <= this.maxIps) return;
    }
  }
}

/** Strip the IPv4-mapped prefix Node reports for IPv4 peers on dual-stack sockets. */
export function normalizeIp(ip: string): string {
  return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}

/** Loopback peers are this machine's own clients and are never rate limited. */
export function isLoopbackIp(ip: string): boolean {
  const n = normalizeIp(ip);
  return n === "::1" || n.startsWith("127.");
}
