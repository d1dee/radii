import { and, eq, gt, ne } from 'drizzle-orm';
import type { db } from '../../db';
import { confirmedCollections, packagePayments, transaction } from '../../db/schema';
import { accrueConfirmedCollection, collectionConfirmationTime } from '../commissions';

type CollectionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Must run on the transaction that confirms the collection, before activation.
// Only the first confirmation is recorded; retries/enrichment cannot rewrite its
// attribution or amount. Nullable attribution stays unknown, never re-inferred.
export async function recordConfirmedCollection(
    tx: CollectionTransaction,
    transactionId: string,
    source: typeof confirmedCollections.$inferInsert['source'],
    confirmationSource: string,
): Promise<void> {
    const rows = await tx.select({
        transactionId: transaction.id,
        packagePaymentId: packagePayments.id,
        customerUserId: packagePayments.userId,
        tenantAdminId: packagePayments.tenantAdminId,
        nasDeviceId: packagePayments.nasDeviceId,
        pppoeServiceAccountId: packagePayments.pppoeServiceAccountId,
        packageId: packagePayments.packageId,
        amount: transaction.amount,
        currency: transaction.currency,
        provider: transaction.provider,
        providerReference: transaction.providerReference,
        providerTransactionId: transaction.providerTransactionId,
    }).from(transaction)
        .innerJoin(packagePayments, eq(packagePayments.transaction, transaction.id))
        .where(and(
            eq(transaction.id, transactionId),
            eq(transaction.type, 'income'),
            eq(transaction.status, 'completed'),
            eq(packagePayments.status, 'paid'),
            gt(transaction.amount, '0'),
            ne(transaction.provider, 'admin-free'),
        ));
    for (const row of rows) {
        // Serialize agreement changes before taking the confirmation clock.
        // PostgreSQL now() is transaction-start time, which can be much earlier.
        const recordedAt = await collectionConfirmationTime(tx, row.tenantAdminId);
        const [collection] = await tx.insert(confirmedCollections).values({ ...row, source, confirmationSource, recordedAt })
            .onConflictDoNothing({ target: confirmedCollections.transactionId }).returning();
        if (collection) await accrueConfirmedCollection(tx, collection);
    }
}
