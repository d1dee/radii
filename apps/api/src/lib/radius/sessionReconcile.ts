import { and, eq, exists, getTableColumns, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db';
import { nasDevice, nasSetupScript, pppoeServiceAccounts, radacct } from '../../db/schema';
import { env } from '../../env';
import { apiLogger } from '../../logging';
import { deriveNasMonitoringPassword, NAS_MONITORING_USERNAME } from '../nasMonitoringCredentials';
import { hasWireGuardManagementRoute } from '../wireguard';
import { fetchNasSessionSnapshot, isNasManagementAddress, nasSessionPresence } from './nasSessionSnapshot';

const logger = apiLogger.getChild('radius');
const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;
const pollSeconds = Math.max(30, positive(env.radius.sessionReconcileSeconds, 60));
const graceMs = Math.max(120, 2 * positive(env.radius.bankInterimSeconds, 60)) * 1000;
const staleMs = Math.max(graceMs, positive(env.radius.sessionStaleSeconds, 180) * 1000,
    3 * positive(env.radius.bankInterimSeconds, 60) * 1000);

const globalRef = globalThis as unknown as {
    __nasSessionTicker?: ReturnType<typeof setInterval>;
    __nasSessionSweep?: Promise<void>;
    __nasSessionAbsences?: Map<string, { fingerprint: string; firstSeen: number }>;
    __nasSessionFailures?: Set<string>;
};
const absences = globalRef.__nasSessionAbsences ??= new Map();
const failures = globalRef.__nasSessionFailures ??= new Set();

export async function reconcileNasSessions(startup = false): Promise<void> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - staleMs);
    const candidates = await db
        .select({
            ...getTableColumns(radacct),
            setupId: nasSetupScript.id,
            nasDeviceId: nasSetupScript.nasDeviceId,
            host: nasSetupScript.wgClientIp,
            radiusSecret: nasSetupScript.radiusSecret,
            pppoe: sql<boolean>`${exists(db.select({ one: sql`1` }).from(pppoeServiceAccounts).where(and(
                eq(pppoeServiceAccounts.username, radacct.username),
                eq(pppoeServiceAccounts.tenantAdminId, nasDevice.ownerId),
            )))}`,
        })
        .from(radacct)
        // Only uniquely assigned tunnel addresses are authoritative. LAN/device
        // IPs may be shared by routers in different tenants and must not match.
        .innerJoin(nasSetupScript, eq(radacct.nasipaddress, nasSetupScript.wgClientIp))
        .innerJoin(nasDevice, eq(nasSetupScript.nasDeviceId, nasDevice.id))
        .where(and(
            isNull(radacct.acctstoptime),
            isNotNull(radacct.acctstarttime),
            lte(radacct.acctstarttime, new Date(now.getTime() - graceMs)),
            startup ? undefined : sql`coalesce(${radacct.acctupdatetime}, ${radacct.acctstarttime}) <= ${staleBefore}`,
            eq(nasSetupScript.sessionMonitoringEnabled, true),
            eq(nasSetupScript.status, 'applied'),
            isNotNull(nasSetupScript.wgPublicKey),
        ));

    const keyFor = (row: typeof candidates[number]) => `${row.setupId}:${row.radacctid}`;
    const currentKeys = new Set(candidates.map(keyFor));
    for (const key of absences.keys()) if (!currentKeys.has(key)) absences.delete(key);
    const groups = new Map<string, typeof candidates>();
    for (const row of candidates) {
        const group = groups.get(row.setupId) ?? [];
        group.push(row);
        groups.set(row.setupId, group);
    }
    for (const id of failures) if (!groups.has(id)) failures.delete(id);
    const targets = [...groups.values()];
    let next = 0;
    let closed = 0;
    const worker = async () => {
        while (next < targets.length) {
            const rows = targets[next++]!;
            const target = rows[0]!;
            try {
                if (!isNasManagementAddress(target.host, env.wgManagementSubnet, env.wgInterfaceIp)) {
                    throw new Error('NAS monitoring requires an assigned WireGuard management address');
                }
                if (!(await hasWireGuardManagementRoute(target.host))) {
                    throw new Error('NAS monitoring requires a ready WireGuard management route');
                }
                const snapshot = await fetchNasSessionSnapshot({
                    host: target.host,
                    username: NAS_MONITORING_USERNAME,
                    password: deriveNasMonitoringPassword(target.nasDeviceId, target.radiusSecret, env.adminBetterAuthSecret),
                }, Math.max(1000, positive(env.radius.nasPollTimeoutMs, 10000)));
                if (failures.delete(target.setupId)) {
                    logger.info('NAS session monitoring recovered', { nasDeviceId: target.nasDeviceId });
                }
                for (const row of rows) {
                    const key = keyFor(row);
                    const lastAccounting = row.acctupdatetime ?? row.acctstarttime!;
                    // Fresh accounting is evidence of recent activity, even if
                    // an earlier snapshot happened to miss a reconnect race.
                    if (lastAccounting > staleBefore) {
                        absences.delete(key);
                        continue;
                    }
                    const ppp = row.framedprotocol?.toLowerCase() === 'ppp';
                    const pppoe = row.pppoe || (ppp && row.nasporttype?.toLowerCase() === 'ethernet');
                    const presence = ppp && !pppoe ? 'unknown' : nasSessionPresence({ ...row, pppoe }, snapshot);
                    if (presence !== 'absent') {
                        absences.delete(key);
                        continue;
                    }
                    const fingerprint = JSON.stringify([
                        row.acctuniqueid, row.acctsessionid, row.acctstarttime,
                        row.username, row.callingstationid, row.calledstationid,
                        row.framedipaddress, row.radiusSecret,
                        row.acctupdatetime, row.acctsessiontime,
                        row.acctinputoctets, row.acctoutputoctets,
                    ]);
                    const previous = absences.get(key);
                    if (!previous || previous.fingerprint !== fingerprint) {
                        absences.set(key, { fingerprint, firstSeen: snapshot.observedAt.getTime() });
                        continue;
                    }
                    if (snapshot.observedAt.getTime() - previous.firstSeen < pollSeconds * 1000) continue;

                    const updated = await db.update(radacct).set({
                        acctstoptime: snapshot.observedAt,
                        acctterminatecause: 'Session-Context-Not-Found',
                    }).where(and(
                        eq(radacct.radacctid, row.radacctid),
                        eq(radacct.acctuniqueid, row.acctuniqueid),
                        eq(radacct.acctsessionid, row.acctsessionid),
                        eq(radacct.nasipaddress, target.host),
                        eq(radacct.acctstarttime, row.acctstarttime!),
                        isNull(radacct.acctstoptime),
                        sql`${radacct.username} is not distinct from ${row.username}`,
                        sql`${radacct.callingstationid} is not distinct from ${row.callingstationid}`,
                        sql`${radacct.calledstationid} is not distinct from ${row.calledstationid}`,
                        sql`${radacct.framedipaddress} is not distinct from ${row.framedipaddress}`,
                        sql`${radacct.acctupdatetime} is not distinct from ${row.acctupdatetime}`,
                        sql`${radacct.acctsessiontime} is not distinct from ${row.acctsessiontime}`,
                        sql`${radacct.acctinputoctets} is not distinct from ${row.acctinputoctets}`,
                        sql`${radacct.acctoutputoctets} is not distinct from ${row.acctoutputoctets}`,
                        // A regeneration/deletion racing this snapshot revokes
                        // its authority to repair accounting for that device.
                        exists(db.select({ one: sql`1` }).from(nasSetupScript).where(and(
                            eq(nasSetupScript.id, row.setupId),
                            eq(nasSetupScript.status, 'applied'),
                            eq(nasSetupScript.sessionMonitoringEnabled, true),
                            eq(nasSetupScript.radiusSecret, row.radiusSecret),
                            eq(nasSetupScript.wgClientIp, row.host),
                        ))),
                    )).returning({ id: radacct.radacctid });
                    closed += updated.length;
                    absences.delete(key);
                }
            } catch (error) {
                // Failure, incomplete snapshots and reboot races are unknown,
                // not absence. They also break consecutive confirmation.
                for (const row of rows) absences.delete(keyFor(row));
                if (!failures.has(target.setupId)) {
                    failures.add(target.setupId);
                    logger.warn('NAS session state is unknown; accounting left unchanged', {
                        nasDeviceId: target.nasDeviceId,
                        reason: error instanceof Error ? error.message : 'NAS polling failed',
                    });
                }
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
    if (closed) logger.info('Stale NAS sessions reconciled', { sessionsClosed: closed });
}

export function startNasSessionReconciliation(): void {
    if (globalRef.__nasSessionTicker) return;
    const run = (startup = false) => {
        if (globalRef.__nasSessionSweep) return;
        globalRef.__nasSessionSweep = reconcileNasSessions(startup)
            .catch((error) => logger.error('NAS session reconciliation failed', { error }))
            .finally(() => { globalRef.__nasSessionSweep = undefined; });
    };
    run(true);
    globalRef.__nasSessionTicker = setInterval(run, pollSeconds * 1000);
    globalRef.__nasSessionTicker.unref();
}
