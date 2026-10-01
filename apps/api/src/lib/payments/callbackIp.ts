// Optional source-IP restriction for the payment callback route.
//
// MPESA_CALLBACK_IP_ALLOWLIST (env) is a comma-separated list of IPs or IPv4
// CIDRs allowed to deliver provider callbacks. Empty = allowlisting disabled
// (a one-time warning is logged at startup, see ./index.ts).
//
// Peer resolution: the direct TCP peer comes from hono/bun connInfo.
// Production deployments usually sit behind a reverse proxy on the same host,
// so X-Forwarded-For is honored ONLY when the direct peer is loopback or
// RFC1918-private; a proxy reached over a public address is not trusted
// because the header would be client-spoofable.
//
// Which XFF entry to trust: an appending proxy (nginx default
// $proxy_add_x_forwarded_for) appends the real client address as the LAST
// (rightmost) entry, while client-supplied spoof values sit to its left — so
// the rightmost entry is used, NOT the first hop. Assumption: exactly ONE
// trusted appending proxy in front of the api. With multiple chained proxies
// the rightmost entry is the innermost proxy's view of its peer (the next
// outer proxy), not the original client; each additional trusted hop would
// require consuming one more entry from the right.
// An unresolvable peer fails closed when the allowlist is enabled.
//
// Limitation: CIDR matching is IPv4-only; IPv6 allowlist entries and IPv6
// peers are compared by exact address.

import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import { env } from '../../env';

// Normalizes IPv4-mapped IPv6 (::ffff:1.2.3.4 -> 1.2.3.4) and lowercases.
function normalizeIp(ip: string): string {
    const trimmed = ip.trim().toLowerCase();
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(trimmed);
    return mapped ? mapped[1] : trimmed;
}

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const octet = Number(part);
        if (octet > 255) return null;
        value = value * 256 + octet;
    }
    return value >>> 0;
}

function isLoopbackOrPrivate(ip: string): boolean {
    if (ip === '::1') return true;
    const v4 = ipv4ToInt(ip);
    if (v4 === null) {
        // IPv6 unique-local (fc00::/7) or link-local (fe80::/10).
        return /^(fc|fd|fe[89ab])/.test(ip);
    }
    const second = (v4 >>> 16) & 0xff;
    return (
        v4 >>> 24 === 127 || // 127.0.0.0/8 loopback
        v4 >>> 24 === 10 || // 10.0.0.0/8
        (v4 >>> 24 === 172 && second >= 16 && second <= 31) || // 172.16.0.0/12
        (v4 >>> 16) === 49320 // 192.168.0.0/16
    );
}

function ipMatchesEntry(ip: string, entry: string): boolean {
    const [range, prefixText] = entry.split('/');
    const normalizedRange = normalizeIp(range ?? '');
    if (prefixText === undefined) return ip === normalizedRange;
    const prefix = Number(prefixText);
    const ipInt = ipv4ToInt(ip);
    const rangeInt = ipv4ToInt(normalizedRange);
    if (
        ipInt === null ||
        rangeInt === null ||
        !Number.isInteger(prefix) ||
        prefix < 0 ||
        prefix > 32
    ) {
        return false;
    }
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipInt & mask) === (rangeInt & mask);
}

// Best-effort source address of a callback delivery (see file header for the
// X-Forwarded-For trust rule). Empty string when it cannot be determined.
export function resolveCallbackSourceIp(c: Context): string {
    let peer = '';
    try {
        peer = normalizeIp(getConnInfo(c).remote.address ?? '');
    } catch {
        // connInfo is unavailable outside the Bun server adapter; treat the
        // peer as unknown (fails closed when the allowlist is enabled).
    }
    if (peer && isLoopbackOrPrivate(peer)) {
        // Rightmost XFF entry = the address the trusted appending proxy saw
        // (the real client); anything to its left is client-supplied and
        // spoofable. See the file header for the single-proxy assumption.
        const forwarded = c.req.header('x-forwarded-for');
        if (forwarded) {
            const hops = forwarded.split(',');
            const lastHop = normalizeIp(hops[hops.length - 1] ?? '');
            if (lastHop) return lastHop;
        }
    }
    return peer;
}

// True when the delivery source passes the configured allowlist (or the
// allowlist is disabled).
export function isCallbackSourceAllowed(c: Context): boolean {
    const allowlist = env.payments.callbackIpAllowlist;
    if (allowlist.length === 0) return true;
    const ip = resolveCallbackSourceIp(c);
    if (!ip) return false;
    return allowlist.some((entry) => ipMatchesEntry(ip, entry));
}
