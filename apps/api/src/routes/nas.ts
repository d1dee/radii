import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db';
import { nasSetupScript } from '../db/schema';
import { jsonError } from '../lib/error';
import { applyNasReport, getSetupScriptForNasDevice } from '../lib/setupScript';
import { upsertPeer, WgError, wgManagementEnabled } from '../lib/wireguard';
import type { AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();

// Called by the router itself (via /tool/fetch at the end of the setup
// script) to register its WireGuard public key and device facts (model,
// serial number, firmware version).
// Unauthenticated but guarded by the per-device registration token embedded
// in the generated script.
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
    if (!script.registrationToken || script.registrationToken !== token) {
        return jsonError(c, 403, 'Invalid registration token');
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
            console.error(
                `[wg] failed to apply peer for NAS ${nasDeviceId}: ${e}`,
            );
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
    if (!script.registrationToken || script.registrationToken !== token) {
        return jsonError(c, 403, 'Invalid token');
    }
    return c.text(script.script, 200, {
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
    if (!script.registrationToken || script.registrationToken !== token) {
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
