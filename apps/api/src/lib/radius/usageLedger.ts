import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { db } from '../../db';
import { activatedPackages, radacct, radiusUsageDelta } from '../../db/schema';
import { currentSpeedBps } from './currentSpeed';

/** Read only already-authorized live sessions; never capture usage from a GET. */
export async function getCurrentSessionSpeeds(
    database: typeof db,
    activationId: string,
    sessionIds: bigint[],
): Promise<Map<string, number | null>> {
    if (sessionIds.length === 0) return new Map();
    const history = database.select({
        radacctId: radiusUsageDelta.radacctId,
        observedAt: radiusUsageDelta.observedAt,
        intervalStartedAt: sql<string>`coalesce(lag(${radiusUsageDelta.observedAt}) over (
            partition by ${radiusUsageDelta.radacctId}, ${radiusUsageDelta.activationId}
            order by ${radiusUsageDelta.observedAt}, ${radiusUsageDelta.id}
        ), ${radacct.acctstarttime})::text`.as('interval_started_at'),
        rank: sql<number>`row_number() over (
            partition by ${radiusUsageDelta.radacctId}, ${radiusUsageDelta.activationId}
            order by ${radiusUsageDelta.observedAt} desc, ${radiusUsageDelta.id} desc
        )`.as('observation_rank'),
        inputOctets: radiusUsageDelta.inputOctets,
        outputOctets: radiusUsageDelta.outputOctets,
        accountingUpdatedAt: sql<string>`greatest(${radacct.acctupdatetime}, ${radacct.acctstarttime})::text`.as('accounting_updated_at'),
        accountingInterval: radacct.acctinterval,
    }).from(radiusUsageDelta)
        .innerJoin(radacct, eq(radiusUsageDelta.radacctId, radacct.radacctid))
        .where(and(
            eq(radiusUsageDelta.activationId, activationId),
            eq(radacct.class, activationId),
            inArray(radacct.radacctid, sessionIds),
            isNotNull(radacct.acctstarttime),
            isNull(radacct.acctstoptime),
        )).as('current_speed_history');
    // Rank after calculating lag over the complete session history, not a date range.
    const rows = await database.select().from(history).where(eq(history.rank, 1));
    return new Map(rows.map((row) => [String(row.radacctId), currentSpeedBps({
        ...row,
        intervalStartedAt: new Date(row.intervalStartedAt),
        accountingUpdatedAt: new Date(row.accountingUpdatedAt),
    })]));
}

// Keep this predicate aligned with radacct_usage_pending_idx. Lower/reset
// counters never lower the high-water mark or make already counted bytes new.
const pendingUsage = sql`(
    ${radacct.usageCapturedInputOctets} is null or
    ${radacct.usageCapturedOutputOctets} is null or
    ${radacct.acctinputoctets} > ${radacct.usageCapturedInputOctets} or
    ${radacct.acctoutputoctets} > ${radacct.usageCapturedOutputOctets}
)`;

/** Record accounting independently of package policy, lifecycle, or service type. */
export async function recordAccountingUsage(
    database: typeof db,
    activationId?: string,
    radacctId?: bigint,
): Promise<number> {
    const candidates = await database
        .selectDistinct({ activationId: activatedPackages.id })
        .from(radacct)
        // Compare as text: malformed/orphan Class values must not cause UUID errors.
        .innerJoin(activatedPackages, sql`${radacct.class} = ${activatedPackages.id}::text`)
        .where(and(
            isNotNull(radacct.acctstarttime),
            pendingUsage,
            activationId ? eq(activatedPackages.id, activationId) : undefined,
            radacctId !== undefined ? eq(radacct.radacctid, radacctId) : undefined,
        ));

    let inserted = 0;
    for (const candidate of candidates) {
        let batchSize: number;
        do {
            batchSize = await database.transaction(async (tx) => {
                // Same lock as the original FUP recorder: concurrent tickers,
                // authorization reads, and older processes cannot count twice.
                await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${candidate.activationId}))`);
                const rows = await tx
                    .select({
                        radacctId: radacct.radacctid,
                        inputOctets: radacct.acctinputoctets,
                        outputOctets: radacct.acctoutputoctets,
                        capturedInput: radacct.usageCapturedInputOctets,
                        capturedOutput: radacct.usageCapturedOutputOctets,
                        observedAt: sql<Date>`greatest(${radacct.acctupdatetime}, ${radacct.acctstoptime}, ${radacct.acctstarttime})`,
                    })
                    .from(radacct)
                    .innerJoin(activatedPackages, sql`${radacct.class} = ${activatedPackages.id}::text`)
                    .where(and(
                        eq(activatedPackages.id, candidate.activationId),
                        isNotNull(radacct.acctstarttime),
                        pendingUsage,
                        radacctId !== undefined ? eq(radacct.radacctid, radacctId) : undefined,
                    ))
                    .orderBy(asc(radacct.radacctid))
                    .limit(500)
                    .for('update', { of: radacct });
                if (rows.length === 0) return 0;

                const captured = await tx
                    .select({
                        radacctId: radiusUsageDelta.radacctId,
                        inputOctets: sql<number>`coalesce(sum(${radiusUsageDelta.inputOctets}), 0)::float8`,
                        outputOctets: sql<number>`coalesce(sum(${radiusUsageDelta.outputOctets}), 0)::float8`,
                    })
                    .from(radiusUsageDelta)
                    .where(and(
                        eq(radiusUsageDelta.activationId, candidate.activationId),
                        inArray(radiusUsageDelta.radacctId, rows.map((row) => row.radacctId)),
                    ))
                    .groupBy(radiusUsageDelta.radacctId);
                const bySession = new Map(captured.map((row) => [row.radacctId, row]));
                const deltas: (typeof radiusUsageDelta.$inferInsert)[] = [];
                for (const row of rows) {
                    const prior = bySession.get(row.radacctId);
                    const inputHighWater = Math.max(row.capturedInput ?? 0, Number(prior?.inputOctets ?? 0));
                    const outputHighWater = Math.max(row.capturedOutput ?? 0, Number(prior?.outputOctets ?? 0));
                    const inputOctets = Math.max(0, Number(row.inputOctets ?? 0) - inputHighWater);
                    const outputOctets = Math.max(0, Number(row.outputOctets ?? 0) - outputHighWater);
                    if (inputOctets > 0 || outputOctets > 0) {
                        // The first capture is one accumulated observation at the
                        // latest accounting timestamp, not invented past intervals.
                        deltas.push({
                            radacctId: row.radacctId,
                            activationId: candidate.activationId,
                            observedAt: row.observedAt,
                            inputOctets,
                            outputOctets,
                        });
                    }
                    await tx.update(radacct).set({
                        usageCapturedInputOctets: inputHighWater + inputOctets,
                        usageCapturedOutputOctets: outputHighWater + outputOctets,
                    }).where(eq(radacct.radacctid, row.radacctId));
                }
                if (deltas.length > 0) await tx.insert(radiusUsageDelta).values(deltas);
                inserted += deltas.length;
                return rows.length;
            });
        } while (batchSize === 500);
    }
    return inserted;
}
