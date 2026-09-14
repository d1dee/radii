export function allowanceForRemainingTime(
    usedSeconds: number,
    remainingSeconds: number,
): number {
    return Math.round(usedSeconds + remainingSeconds);
}

export function activationIsAvailable({
    deactivatedAt,
    expireAt,
    remainingSeconds,
    now,
}: {
    deactivatedAt: Date | null;
    expireAt: Date;
    remainingSeconds: number;
    now: Date;
}): boolean {
    return (
        deactivatedAt === null &&
        expireAt.getTime() > now.getTime() &&
        remainingSeconds > 0
    );
}

export function calculateActivationTime({
    activatedAt,
    expireAt,
    packageAllowanceSeconds,
    allowanceOverrideSeconds,
    usedSeconds,
    cumulative,
    now,
}: {
    activatedAt: Date;
    expireAt: Date;
    packageAllowanceSeconds: number;
    allowanceOverrideSeconds: number | null;
    usedSeconds: number;
    cumulative: boolean;
    now: Date;
}): { sessionLimitSeconds: number; remainingSeconds: number } {
    const calendarLimitSeconds = Math.max(
        1,
        Math.round((expireAt.getTime() - activatedAt.getTime()) / 1000),
    );
    const allowanceSeconds =
        allowanceOverrideSeconds ?? packageAllowanceSeconds;
    const hasTimeAllowance = cumulative || allowanceOverrideSeconds !== null;
    const allowanceRemainingSeconds = Math.max(
        0,
        Math.round(allowanceSeconds - usedSeconds),
    );
    const calendarRemainingSeconds = Math.max(
        0,
        Math.round((expireAt.getTime() - now.getTime()) / 1000),
    );

    return {
        sessionLimitSeconds: hasTimeAllowance
            ? Math.min(allowanceSeconds, calendarLimitSeconds)
            : calendarLimitSeconds,
        remainingSeconds: hasTimeAllowance
            ? Math.min(allowanceRemainingSeconds, calendarRemainingSeconds)
            : calendarRemainingSeconds,
    };
}
