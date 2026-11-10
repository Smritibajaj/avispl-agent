/**
 * Simple in-memory sliding-window rate limit per client IP (per server instance; resets on restart).
 * A cost guard, not security: on Vercel each instance keeps its own window.
 */
export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    readonly limit = 20,
    readonly windowMs = 10 * 60_000,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((list[0]! + this.windowMs - now) / 1000)) };
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => t > from)) this.hits.delete(k);
    return { ok: true, remaining: this.limit - list.length, retryAfterSec: 0 };
  }
}

export const clientIp = (req: Request): string =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "local";

const envInt = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : d;
};

/** 20 requests per 10 minutes by default; CHAT_RATE_LIMIT / CHAT_RATE_WINDOW_SEC override. */
export const chatRateLimiter = new RateLimiter(
  envInt(process.env.CHAT_RATE_LIMIT, 20),
  envInt(process.env.CHAT_RATE_WINDOW_SEC, 600) * 1000,
);
