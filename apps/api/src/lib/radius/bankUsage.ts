import type { radacct } from '../../db/schema';

type Ledger = Pick<
    typeof radacct.$inferSelect,
    'bankWaivedSeconds' | 'bankBonusStartSeconds' | 'bankBonusEndSeconds'
>;

export function bankSessionUsage(seconds: number, ledger: Ledger, live: boolean) {
    const elapsed = Math.max(0, Math.round(seconds));
    const start = ledger.bankBonusStartSeconds;
    const end = ledger.bankBonusEndSeconds;
    const consumed = start !== null && end !== null
        ? Math.min(Math.max(0, elapsed - start), Math.max(0, end - start))
        : 0;
    const bankWaivedSeconds = Math.min(
        elapsed,
        Math.max(0, ledger.bankWaivedSeconds) + consumed,
    );
    return {
        bankWaivedSeconds,
        bankChargedSeconds: elapsed - bankWaivedSeconds,
        bonusRemainingSeconds: live && start !== null && end !== null
            ? Math.max(0, end - elapsed)
            : 0,
    };
}

export function additionalBankTime(seconds: number, ledger: Ledger, additionalSeconds: number) {
    const usage = bankSessionUsage(seconds, ledger, true);
    const start = Math.max(0, Math.round(seconds));
    return {
        bankWaivedSeconds: usage.bankWaivedSeconds,
        bankBonusStartSeconds: start,
        bankBonusEndSeconds: start + usage.bonusRemainingSeconds + additionalSeconds,
    };
}

export function bankSessionTimeout(bucketRemaining: number, bonusRemaining: number, validityRemaining: number) {
    return Math.max(0, Math.min(validityRemaining, bucketRemaining + bonusRemaining));
}
