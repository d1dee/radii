// Per-IP HTTP rate limiting for the public API surface.
//
// Single-process in-memory fixed-window limiter: the api runs as ONE
// Bun.serve instance (src/index.ts), so a plain Map is authoritative — no
// Redis or other shared store. If the deployment ever scales horizontally,
// each instance would keep independent counters and the effective limit
// multiplies by the instance count; move to a shared store then.
//
// Tiers (per IP within one fixed window — env-configurable, see src/env.ts):
//   auth     RATE_LIMIT_AUTH_MAX    (default  20) /api/auth/*, /api/admin/auth/*
//   portal   RATE_LIMIT_PORTAL_MAX  (default 120) /api/hotspot/*, /api/ppoe/*
//   default  RATE_LIMIT_DEFAULT_MAX (default 300) every other /api/* route
// GET /api/auth/get-session and GET /api/admin/auth/get-session are tiered as
// 'default', NOT 'auth': all three frontends poll them every ~10s per tab and
// NATed hotspot customers share the NAS's single egress IP, so the strict
// auth budget would 429 legitimate logins. Credential paths (POST sign-in,
// sign-up, OTP, ...) stay on 'auth'.
// Window length: RATE_LIMIT_WINDOW_SECONDS (default 60). The auth tier
// complements better-auth's own internal rate limiter; the portal tier is
// generous because NATed hotspot customers share a single egress IP.
//
// EXEMPT (explicitly, and nothing else is exempt):
//   /api/radius/rest/* — authenticated by the RADIUS_REST_API_KEY shared
//                        secret; the single FreeRADIUS server IP issues a
//                        high volume of authorize/post-auth callbacks that
//                        per-IP limiting would throttle into a RADIUS outage.
//   /api/nas/*         — router traffic authenticated by per-device
//                        bootstrap tokens; low volume per device, but many
//                        devices can sit behind one NAT address.
//   /health            — liveness probe (not under /api/*, never limited).
//
// Peer IP resolution reuses the payment-callback helper
// (lib/payments/callbackIp.ts): X-Forwarded-For is honored (rightmost entry
// appended by the trusted proxy) ONLY when the direct TCP peer is
// loopback/RFC1918/IPv6-ULA; behind a proxy reached over a public address
// the header is client-spoofable and ignored.
//
// Memory bounds: expired windows are swept on an interval, and the tracked
// key set is hard-capped with oldest-inserted-first eviction, so a flood of
// spoofed X-Forwarded-For values cannot grow the map without bound.

import type { MiddlewareHandler } from 'hono';
import { env } from '../env';
import { jsonError } from '../lib/error';
import { resolveCallbackSourceIp } from '../lib/payments/callbackIp';
import { apiLogger } from '../logging';
import type { AppVariables } from '../types';

const logger = apiLogger.getChild('ratelimit');

type Tier = 'auth' | 'portal' | 'default';

// Fixed-window bucket: hit count and the instant the window resets.
interface Bucket {
    count: number;
    resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Hard cap on tracked `tier:ip` keys. Map iteration order is insertion
// order, so eviction drops the oldest-inserted keys first — a spoofed-XFF
// flood can therefore never exceed this many entries (each entry is tiny;
// the sweep interval additionally reclaims expired windows).
const MAX_TRACKED_KEYS = 20_000;

// Periodically drop expired windows so idle IPs do not linger. unref() keeps
// the timer from holding the Bun process open during shutdown/tests.
const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
    }
}, env.rateLimit.windowSeconds * 1000);
sweep.unref();

// Tier for a request path+method, or null when the path is exempt (see
// header). The method matters only for the get-session polls, which are
// read-only session checks the frontends issue every ~10s.
function tierForPath(path: string, method: string): Tier | null {
    // EXEMPT: FreeRADIUS rlm_rest callbacks (shared-secret authed, single
    // high-volume source IP) — limiting these would break RADIUS auth.
    if (path === '/api/radius/rest' || path.startsWith('/api/radius/rest/')) {
        return null;
    }
    // EXEMPT: NAS device traffic (bootstrap-token authed, routers behind NAT).
    if (path.startsWith('/api/nas/')) return null;
    // Session polling reads: default tier (see header) — the strict auth
    // budget is for credential endpoints, not for useSession keepalives from
    // every open tab behind a shared NAT address.
    if (
        method === 'GET' &&
        (path === '/api/auth/get-session' ||
            path === '/api/admin/auth/get-session')
    ) {
        return 'default';
    }
    if (path.startsWith('/api/auth/')) return 'auth';
    if (path.startsWith('/api/admin/auth/')) return 'auth';
    if (path.startsWith('/api/hotspot/')) return 'portal';
    if (path.startsWith('/api/ppoe/')) return 'portal';
    return 'default';
}

function maxForTier(tier: Tier): number {
    switch (tier) {
        case 'auth':
            return env.rateLimit.authMax;
        case 'portal':
            return env.rateLimit.portalMax;
        default:
            return env.rateLimit.defaultMax;
    }
}

export const rateLimit: MiddlewareHandler<{ Variables: AppVariables }> = async (
    c,
    next,
) => {
    const tier = tierForPath(c.req.path, c.req.method);
    if (!tier) return next();

    // An unresolvable peer (connInfo unavailable) buckets under one shared
    // key rather than bypassing the limiter entirely.
    const ip = resolveCallbackSourceIp(c) || 'unknown';
    const key = `${tier}:${ip}`;
    const now = Date.now();
    const windowMs = env.rateLimit.windowSeconds * 1000;

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        while (buckets.size >= MAX_TRACKED_KEYS) {
            const oldest = buckets.keys().next().value;
            if (oldest === undefined) break;
            buckets.delete(oldest);
        }
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > maxForTier(tier)) {
        const retryAfter = Math.max(
            1,
            Math.ceil((bucket.resetAt - now) / 1000),
        );
        logger.warn('Rate limit exceeded', {
            tier,
            path: c.req.path,
            method: c.req.method,
        });
        c.header('Retry-After', String(retryAfter));
        return jsonError(
            c,
            429,
            'Too many requests — please retry later',
        );
    }

    await next();
};
