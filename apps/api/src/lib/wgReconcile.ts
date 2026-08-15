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
import {
    interfaceReady,
    listPeerPublicKeys,
    removePeer,
    upsertPeer,
} from './wireguard';
import { env } from '../env';

export async function reconcileWireGuardPeers(): Promise<void> {
    if (!env.wgManagePeers) {
        console.log(
            '[wg] peer management disabled (set WG_MANAGE_PEERS=true to enable)',
        );
        return;
    }

    if (!(await interfaceReady())) {
        console.error(
            `[wg] interface '${env.wgIface}' is not available — skipping reconciliation`,
        );
        return;
    }

    const rows = await db
        .select()
        .from(nasSetupScript)
        .where(isNotNull(nasSetupScript.wgPublicKey));

    const upserted = new Set<string>();
    for (const row of rows) {
        const publicKey = row.wgPublicKey as string;
        try {
            await upsertPeer({
                publicKey,
                presharedKey: row.wgPsk,
                allowedIps: [`${row.wgClientIp}/32`],
            });
            upserted.add(publicKey);
        } catch (e) {
            console.error(
                `[wg] reconcile: failed to upsert peer for script ${row.id}: ${e}`,
            );
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
                    console.error(
                        `[wg] reconcile: failed to remove stale peer ${publicKey}: ${e}`,
                    );
                }
            }
        }
    } catch (e) {
        console.error(`[wg] reconcile: could not list interface peers: ${e}`);
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

    console.log(
        `[wg] reconcile complete: ${rows.length} expected peers, ` +
            `${upserted.size} ensured, ${removed} stale removed, ` +
            `${healed.length} failed rows healed`,
    );
}
