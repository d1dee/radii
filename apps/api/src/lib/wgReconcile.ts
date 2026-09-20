// WireGuard reconciliation: the nas_setup_script table is the single source
// of truth for peering, and this module converges the live interface to it.
//
//   1. Upsert every peer the DB knows about (incremental `wg set` — other
//      tunnels are never disturbed; PSK/allowed-ips are re-asserted, which
//      also heals rows marked 'failed' by an earlier apply error).
//   2. Prune peers present on the interface that no DB row references
//      (leftovers from regenerations or manual edits).
//
// Failures never crash the caller: reconciliation logs and moves on.

import { inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { nasSetupScript } from '../db/schema';
import { env } from '../env';
import { apiLogger } from '../logging';
import {
    interfaceReady,
    listPeerPublicKeys,
    removePeer,
    upsertPeer,
} from './wireguard';

const logger = apiLogger.getChild('wireguard');

export async function reconcileWireGuardPeers(): Promise<void> {
    if (!env.wgManagePeers) {
        logger.info('WireGuard peer management is disabled');
        return;
    }

    if (!(await interfaceReady())) {
        logger.error('WireGuard interface is unavailable; skipping reconciliation', {
            interface: env.wgIface,
        });
        return;
    }

    const rows = await db
        .select()
        .from(nasSetupScript)
        .where(isNotNull(nasSetupScript.wgPublicKey));

    const upserted = new Set<string>();
    for (const row of rows) {
        const publicKey = row.wgPublicKey!;
        try {
            await upsertPeer({
                publicKey,
                presharedKey: row.wgPsk,
                allowedIps: [`${row.wgClientIp}/32`],
            });
            upserted.add(publicKey);
        } catch (e) {
            logger.error('Failed to reconcile WireGuard peer', {
                setupScriptId: row.id,
                error: e,
            });
        }
    }

    // Prune only peers absent from the DB entirely; a transient upsert
    // failure above must never cause a known peer to be removed.
    const desiredKeys = new Set(rows.map((row) => row.wgPublicKey as string));

    let removed = 0;
    try {
        const current = await listPeerPublicKeys();
        for (const publicKey of current) {
            if (!desiredKeys.has(publicKey)) {
                try {
                    await removePeer(publicKey);
                    removed += 1;
                } catch (e) {
                    logger.error('Failed to remove stale WireGuard peer', {
                        error: e,
                    });
                }
            }
        }
    } catch (e) {
        logger.error('Failed to list WireGuard peers', { error: e });
    }

    // Heal rows whose server-side peer apply failed earlier.
    const healed = rows.filter(
        (row) => row.status === 'failed' && upserted.has(row.wgPublicKey!),
    );
    if (healed.length > 0) {
        await db
            .update(nasSetupScript)
            .set({ status: 'applied' })
            .where(
                inArray(
                    nasSetupScript.id,
                    healed.map((row) => row.id),
                ),
            );
    }

    logger.info('WireGuard reconciliation completed', {
        expectedPeers: rows.length,
        ensuredPeers: upserted.size,
        removedPeers: removed,
        healedRows: healed.length,
    });
}
