import { z } from 'zod';

export const activationEditSchema = z.object({
    expireAt: z.iso.datetime(),
    remainingSeconds: z.number().int().min(0),
    uploadRate: z.number().int().min(0).max(2147483647).optional(),
    downloadRate: z.number().int().min(0).max(2147483647).optional(),
}).refine((value) => (value.uploadRate === undefined) === (value.downloadRate === undefined), {
    message: 'Upload and download rates must be supplied together',
});

export function allowanceForRemainingTime(
    usedSeconds: number,
    remainingSeconds: number,
): number {
    return Math.round(usedSeconds + remainingSeconds);
}

export function activationIsAvailable({
    activatedAt,
    deactivatedAt,
    expireAt,
    remainingSeconds,
    now,
}: {
    activatedAt: Date;
    deactivatedAt: Date | null;
    expireAt: Date;
    remainingSeconds: number;
    now: Date;
}): boolean {
    return (
        deactivatedAt === null &&
        activatedAt.getTime() <= now.getTime() &&
        expireAt.getTime() > now.getTime() &&
        remainingSeconds > 0
    );
}

export function calculatePppoeActivationWindow({
    mode,
    now,
    queueTailExpiresAt,
    durationMinutes,
}: {
    mode: 'after_previous_expires' | 'immediate';
    now: Date;
    queueTailExpiresAt: Date | null;
    durationMinutes: number;
}): { activatedAt: Date; expireAt: Date } {
    const activatedAt =
        mode === 'after_previous_expires' &&
        queueTailExpiresAt &&
        queueTailExpiresAt.getTime() > now.getTime()
            ? queueTailExpiresAt
            : now;
    return {
        activatedAt,
        expireAt: new Date(
            activatedAt.getTime() + durationMinutes * 60 * 1000,
        ),
    };
}

// Reorder only future purchases. Existing active windows retain immediate-mode
// behavior, while every queued purchase keeps its stored (not catalog) duration.
export function startPppoeQueueNow(
    activations: { id: string; activatedAt: Date; expireAt: Date }[],
    activationId: string,
    now: Date,
): { id: string; activatedAt: Date; expireAt: Date }[] | null {
    const selected = activations.find((row) => row.id === activationId);
    if (!selected || selected.activatedAt.getTime() <= now.getTime()) return null;
    const queued = activations
        .filter((row) => row.activatedAt.getTime() > now.getTime())
        .sort((a, b) => a.activatedAt.getTime() - b.activatedAt.getTime() || a.id.localeCompare(b.id));
    if (queued.some((row) => !Number.isFinite(row.expireAt.getTime() - row.activatedAt.getTime()) || row.expireAt.getTime() <= row.activatedAt.getTime())) {
        return null;
    }
    const started = {
        id: selected.id,
        activatedAt: now,
        expireAt: new Date(now.getTime() + selected.expireAt.getTime() - selected.activatedAt.getTime()),
    };
    let tail = Math.max(started.expireAt.getTime(), ...activations
        .filter((row) => row.activatedAt.getTime() <= now.getTime())
        .map((row) => row.expireAt.getTime()));
    const updates = [started];
    for (const row of queued) {
        if (row.id === selected.id) continue;
        const expireAt = new Date(tail + row.expireAt.getTime() - row.activatedAt.getTime());
        updates.push({ id: row.id, activatedAt: new Date(tail), expireAt });
        tail = expireAt.getTime();
    }
    return updates;
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
