import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { db } from '../../db';
import { activatedPackages, radacct, radiusUsageDelta } from '../../db/schema';

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
