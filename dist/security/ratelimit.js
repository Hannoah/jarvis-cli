export class RateLimiter {
    hits = new Map();
    max;
    windowMs;
    maxIps;
    now;
    constructor(opts = {}) {
        this.max = opts.max ?? 300;
        this.windowMs = opts.windowMs ?? 60_000;
        this.maxIps = opts.maxIps ?? 10_000;
        this.now = opts.now ?? Date.now;
    }
    take(ip) {
        const t = this.now();
        let e = this.hits.get(ip);
        if (!e || t >= e.resetAt) {
            e = { count: 0, resetAt: t + this.windowMs };
            this.hits.set(ip, e);
            if (this.hits.size > this.maxIps)
                this.prune(t);
        }
        e.count++;
        if (e.count <= this.max)
            return { allowed: true, audit: false, retryAfterSec: 0 };
        return {
            allowed: false,
            audit: e.count === this.max + 1,
            retryAfterSec: Math.max(1, Math.ceil((e.resetAt - t) / 1000)),
        };
    }
    /** For tests and (later) observability. */
    get size() {
        return this.hits.size;
    }
    prune(t) {
        for (const [ip, e] of this.hits) {
            if (e.resetAt <= t)
                this.hits.delete(ip);
            if (this.hits.size <= this.maxIps)
                return;
        }
        // No expired entries (a real flood of distinct IPs): drop the oldest windows first.
        for (const ip of this.hits.keys()) {
            this.hits.delete(ip);
            if (this.hits.size <= this.maxIps)
                return;
        }
    }
}
/** Strip the IPv4-mapped prefix Node reports for IPv4 peers on dual-stack sockets. */
export function normalizeIp(ip) {
    return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}
/** Loopback peers are this machine's own clients and are never rate limited. */
export function isLoopbackIp(ip) {
    const n = normalizeIp(ip);
    return n === "::1" || n.startsWith("127.");
}
