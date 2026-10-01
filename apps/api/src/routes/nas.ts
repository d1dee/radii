import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db';
import { nasSetupScript } from '../db/schema';
import { jsonError } from '../lib/error';
import {
    applyNasReport,
    deriveNasPageToken,
    getSetupScriptForNasDevice,
    hashNasToken,
    nasTokenMatchesHash,
    substituteNasScriptTokens,
} from '../lib/setupScript';
import { upsertPeer, WgError, wgManagementEnabled } from '../lib/wireguard';
import { apiLogger } from '../logging';
import type { AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();
const logger = apiLogger.getChild('wireguard');

// A WireGuard public key is 32 bytes, base64-encoded to exactly 44 chars
// ending in '='. Verify the canonical form and decoded length so an
// attacker-chosen value can never be passed to `wg` as a peer key.
function isValidWgPublicKey(key: string): boolean {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) return false;
    return Buffer.from(key, 'base64').length === 32;
}

// Rejects a bootstrap token that was already consumed (one-shot: nulled by
// the first successful report) or whose expiry has passed. Returns a stable
// reason for logging/error messaging; the caller still runs the
// constant-time hash comparison for a "present but valid" token.
function bootstrapTokenRejectedReason(
    script: {
        bootstrapTokenHash: string | null;
        bootstrapExpiresAt: Date | null;
    },
): 'consumed' | 'expired' | null {
    if (!script.bootstrapTokenHash) return 'consumed';
    if (
        script.bootstrapExpiresAt &&
        script.bootstrapExpiresAt.getTime() < Date.now()
    ) {
        return 'expired';
    }
    return null;
}

// Called by the router itself (via /tool/fetch at the end of the setup
// script) to register its WireGuard public key and device facts (model,
// serial number, firmware version).
// Unauthenticated but guarded by the per-device one-shot bootstrap token
// embedded in the generated script. On success the bootstrap token is
// consumed (bootstrapTokenHash nulled) so neither /script nor a second
// credential-changing /report works again until an admin regenerates.
app.post('/:id/report', async (c) => {
    const body = await c.req.parseBody();
    const field = (name: string): string | undefined => {
        const value = String(body[name] ?? '').trim();
        return value || undefined;
    };

    const token = field('token');
    const publicKey = field('publicKey');
    const nasDeviceId = c.req.param('id');

    if (!token || !publicKey) {
        return jsonError(c, 400, 'Missing token or publicKey');
    }
    const script = await getSetupScriptForNasDevice(nasDeviceId);
    if (!script) {
        return jsonError(c, 404, 'Unknown NAS device');
    }
    const rejection = bootstrapTokenRejectedReason(script);
    if (rejection === 'consumed') {
        return jsonError(
            c,
            403,
            'Registration already completed; regenerate the setup script to re-register',
        );
    }
    if (rejection === 'expired') {
        return jsonError(
            c,
            403,
            'Registration token expired; regenerate the setup script',
        );
    }
    if (!nasTokenMatchesHash(token, script.bootstrapTokenHash!)) {
        return jsonError(c, 403, 'Invalid registration token');
    }
    if (!isValidWgPublicKey(publicKey)) {
        return jsonError(c, 400, 'Invalid WireGuard public key');
    }

    // Atomically consume the one-shot bootstrap token BEFORE mutating any
    // state. The conditional UPDATE (WHERE bootstrapTokenHash still equals the
    // presented token's hash) means exactly one caller wins under a race: a
    // concurrent second report — e.g. an attacker trying to re-register their
    // own WireGuard publicKey for this device's tunnel IP — matches 0 rows and
    // is rejected, and never reaches applyNasReport/upsertPeer.
    const consumed = await db
        .update(nasSetupScript)
        .set({
            bootstrapTokenHash: null,
            pageTokenHash: hashNasToken(deriveNasPageToken(token)),
        })
        .where(
            and(
                eq(nasSetupScript.id, script.id),
                eq(nasSetupScript.bootstrapTokenHash, hashNasToken(token)),
            ),
        )
        .returning({ id: nasSetupScript.id });
    if (consumed.length === 0) {
        return jsonError(
            c,
            403,
            'Registration token already used; regenerate the setup script to re-register',
        );
    }

    const row = await applyNasReport(script.id, nasDeviceId, {
        publicKey,
        model: field('model'),
        serialNumber: field('serialNumber'),
        firmwareVersion: field('firmwareVersion'),
        boardName: field('boardName'),
        architecture: field('architecture'),
    });
    if (!row) {
        return jsonError(c, 404, 'Setup script no longer exists');
    }

    // Complete the tunnel server-side: register the reported key as a peer
    // on the management interface, with the allocated tunnel address as its
    // only allowed IP. Incremental `wg set` — other tunnels are untouched.
    if (wgManagementEnabled()) {
        try {
            await upsertPeer({
                publicKey,
                presharedKey: row.wgPsk,
                allowedIps: [`${row.wgClientIp}/32`],
            });
        } catch (e) {
            logger.error('Failed to apply NAS peer', {
                nasDeviceId,
                error: e,
            });
            // The token is already consumed; the reported key is persisted, so
            // startup reconciliation repairs this 'failed' row. The router
            // never re-reports, so there is nothing to reopen here.
            await db
                .update(nasSetupScript)
                .set({ status: 'failed' })
                .where(eq(nasSetupScript.id, row.id));
            const hint =
                e instanceof WgError ? e.message : 'unexpected server error';
            return jsonError(
                c,
                500,
                `Device reported but WireGuard peer could not be applied: ${hint}`,
            );
        }
    }

    await db
        .update(nasSetupScript)
        .set({ status: 'applied' })
        .where(eq(nasSetupScript.id, row.id));

    return c.json({ success: true });
});

app.get('/:id/script', async (c) => {
    const token = c.req.query('token');
    if (!token) {
        return jsonError(c, 400, 'Missing token');
    }
    const nasDeviceId = c.req.param('id');
    const script = await getSetupScriptForNasDevice(nasDeviceId);
    if (!script) {
        return jsonError(c, 404, 'Unknown NAS device');
    }
    const rejection = bootstrapTokenRejectedReason(script);
    if (rejection === 'consumed') {
        return jsonError(
            c,
            403,
            'Setup script already retrieved; regenerate to download again',
        );
    }
    if (rejection === 'expired') {
        return jsonError(
            c,
            403,
            'Registration token expired; regenerate the setup script',
        );
    }
    if (!nasTokenMatchesHash(token, script.bootstrapTokenHash!)) {
        return jsonError(c, 403, 'Invalid token');
    }
    // The stored script keeps {{BOOTSTRAP_TOKEN}} / {{PAGE_TOKEN}}
    // placeholders; substitute the live tokens now (the token was just
    // verified against its hash) so no plaintext is ever persisted.
    return c.text(substituteNasScriptTokens(script.script, token), 200, {
        'Content-Type': 'text/plain; charset=utf-8',
    });
});

const VALID_HOTSPOT_PAGES = new Set([
    'login.html',
    'alogin.html',
    'status.html',
    'logout.html',
    'error.html',
    'radvert.html',
    'redirect.html',
]);

app.get('/:id/hotspot/:page', async (c) => {
    const token = c.req.query('token');
    if (!token) {
        return jsonError(c, 400, 'Missing token');
    }
    const nasDeviceId = c.req.param('id');
    const page = c.req.param('page');
    if (!VALID_HOTSPOT_PAGES.has(page)) {
        return jsonError(c, 404, 'Unknown hotspot page');
    }
    const script = await getSetupScriptForNasDevice(nasDeviceId);
    if (!script) {
        return jsonError(c, 404, 'Unknown NAS device');
    }
    // The served pages embed the per-device portal secret (login.html), so
    // the page token is a sensitive bearer credential — still not consumed by
    // the report and without expiry, and the pages carry no RADIUS/WG secrets.
    if (!script.pageTokenHash || !nasTokenMatchesHash(token, script.pageTokenHash)) {
        return jsonError(c, 403, 'Invalid token');
    }
    const content = script.hotspotPages?.[page.replace(/\.html$/, '')];
    if (!content) {
        return jsonError(c, 404, 'Hotspot page not found');
    }
    return c.text(content, 200, {
        'Content-Type': 'text/html; charset=utf-8',
    });
});

export default app;
