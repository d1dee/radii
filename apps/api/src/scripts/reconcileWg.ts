// Standalone WireGuard reconciliation: converges the live interface to the
// database and exits. Safe to run repeatedly or from cron/CI; the server
// also runs the same reconciliation at startup.
//
//   bun run wg:reconcile

import { closeDb } from '../db';
import { reconcileWireGuardPeers } from '../lib/wgReconcile';

await reconcileWireGuardPeers().catch((err) => {
    console.error('[wg] reconciliation error:', err);
    process.exitCode = 1;
});

await closeDb();
