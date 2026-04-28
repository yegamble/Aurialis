/**
 * Sliding-window rate-limiter Durable Objects.
 *
 *   RateLimitDO         — one DO instance per cf-connecting-ip (per-IP cap)
 *   GlobalRateLimitDO   — single DO instance (id="global"), account-wide cap
 *
 * Both classes share the same algorithm: SQLite-backed list of timestamps,
 * pruned on each call to drop entries older than 1 hour. If the remaining
 * count is >= limit, return { allowed: false, retryAfterSec }.
 *
 * The Worker calls per-IP first, global second — so a small abuser hits the
 * cheap per-IP gate before touching the shared global counter.
 */

import { DurableObject } from "cloudflare:workers";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec?: number;
}

abstract class BaseRateLimitDO extends DurableObject {
  protected storage: DurableObjectStorage;
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.storage = state.storage;
    this.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS hits (ts INTEGER NOT NULL)"
    );
    this.storage.sql.exec("CREATE INDEX IF NOT EXISTS hits_ts ON hits (ts)");
  }

  protected async check(limit: number): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    this.storage.sql.exec("DELETE FROM hits WHERE ts < ?", cutoff);
    const row = this.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM hits")
      .one();
    const count = Number(row?.count ?? 0);
    if (count >= limit) {
      const oldestRow = this.storage.sql
        .exec<{ ts: number }>("SELECT ts FROM hits ORDER BY ts ASC LIMIT 1")
        .one();
      const oldest = Number(oldestRow?.ts ?? now);
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldest + WINDOW_MS - now) / 1000)
      );
      return { allowed: false, remaining: 0, retryAfterSec };
    }
    this.storage.sql.exec("INSERT INTO hits (ts) VALUES (?)", now);
    return { allowed: true, remaining: limit - count - 1 };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "0");
    if (!Number.isFinite(limit) || limit <= 0) {
      return new Response(
        JSON.stringify({ error: "invalid_limit" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    const result = await this.check(limit);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}

export class RateLimitDO extends BaseRateLimitDO {}
export class GlobalRateLimitDO extends BaseRateLimitDO {}

interface RateLimitEnv {
  RATE_LIMIT_PER_IP: DurableObjectNamespace<RateLimitDO>;
  RATE_LIMIT_GLOBAL: DurableObjectNamespace<GlobalRateLimitDO>;
  RATE_LIMIT_PER_HOUR: string;
  GLOBAL_RATE_LIMIT_PER_HOUR: string;
}

async function callDo<T extends BaseRateLimitDO>(
  ns: DurableObjectNamespace<T>,
  id: DurableObjectId,
  limit: number
): Promise<RateLimitResult> {
  const stub = ns.get(id);
  const url = `https://rate-limit.internal/?limit=${limit}`;
  const res = await stub.fetch(new Request(url, { method: "GET" }));
  return (await res.json()) as RateLimitResult;
}

export async function checkRateLimits(
  env: RateLimitEnv,
  ip: string
): Promise<{ allowed: boolean; retryAfterSec?: number; scope?: "per-ip" | "global" }> {
  const perIpLimit = Number(env.RATE_LIMIT_PER_HOUR);
  const globalLimit = Number(env.GLOBAL_RATE_LIMIT_PER_HOUR);

  const perIpId = env.RATE_LIMIT_PER_IP.idFromName(ip || "unknown");
  const perIp = await callDo(env.RATE_LIMIT_PER_IP, perIpId, perIpLimit);
  if (!perIp.allowed) {
    return { allowed: false, retryAfterSec: perIp.retryAfterSec, scope: "per-ip" };
  }

  const globalId = env.RATE_LIMIT_GLOBAL.idFromName("global");
  const global = await callDo(env.RATE_LIMIT_GLOBAL, globalId, globalLimit);
  if (!global.allowed) {
    return { allowed: false, retryAfterSec: global.retryAfterSec, scope: "global" };
  }

  return { allowed: true };
}
