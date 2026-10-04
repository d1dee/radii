import {
    Badge,
    Button,
    Divider,
    Group,
    NumberInput,
    Stack,
    Text,
} from '@mantine/core';
import { useState } from 'react';

import {
    activateSessionFup,
    addSessionBonus,
    editSessionTimeout,
    type AdminSessionDetail,
} from '@/lib/api';
import { formatSeconds } from '@/lib/format';
import { notifyResult } from '@/lib/notify';

export function SessionAdjustmentControls({
    detail,
    onAdjusted,
}: {
    detail: AdminSessionDetail;
    onAdjusted: () => void;
}) {
    const [minutes, setMinutes] = useState<number | string>('');
    const [busy, setBusy] = useState<'time' | 'fup' | null>(null);
    const { session, adjustments } = detail;
    const validMinutes =
        typeof minutes === 'number' &&
        Number.isFinite(minutes) &&
        minutes >= 1 &&
        Number.isSafeInteger(Math.round(minutes * 60));

    const adjust = async (action: 'time' | 'fup') => {
        if (busy || !session.live || (action === 'time' && !validMinutes)) {
            return;
        }
        setBusy(action);
        try {
            const result =
                action === 'time'
                    ? await (adjustments.timeBank
                          ? addSessionBonus
                          : editSessionTimeout)(
                          session.radacctId,
                          Math.round(Number(minutes) * 60),
                      )
                    : await activateSessionFup(session.radacctId);
            notifyResult(
                result,
                action === 'time'
                    ? adjustments.timeBank
                        ? 'Additional session time added'
                        : 'Session time updated'
                    : 'FUP activated',
            );
            // A failed CoA can still reconcile a session absent from the NAS.
            onAdjusted();
        } finally {
            setBusy(null);
        }
    };

    if (!session.live) {
        return (
            <Text size='sm' c='dimmed'>
                Ended sessions cannot be adjusted.
            </Text>
        );
    }

    return (
        <Stack gap='md'>
            <Text size='sm' c='dimmed'>
                {session.username || 'This session'} has been connected for{' '}
                {formatSeconds(session.seconds)}.
            </Text>
            <Stack gap='xs'>
                {adjustments.timeBank ? (
                    <Stack gap={2}>
                        <Text size='sm'>
                            Additional time remaining:{' '}
                            {formatSeconds(adjustments.bonusRemainingSeconds)}
                        </Text>
                        <Text size='sm' c='dimmed'>
                            Bucket remaining:{' '}
                            {formatSeconds(
                                adjustments.bankRemainingSeconds ?? 0,
                            )}
                            {adjustments.bonusRemainingSeconds > 0
                                ? ' (paused for this session)'
                                : ''}
                        </Text>
                    </Stack>
                ) : null}
                {adjustments.remainingSeconds !== null ? (
                    <Text size='sm'>
                        Session remaining time:{' '}
                        {formatSeconds(adjustments.remainingSeconds)}
                    </Text>
                ) : null}
                <NumberInput
                    label={
                        adjustments.timeBank
                            ? 'Additional session time (minutes)'
                            : 'New remaining time (minutes)'
                    }
                    description={
                        adjustments.timeBank
                            ? 'Adds time to this session, consumed before the bucket. Unused additional time ends with the session. Package validity still applies.'
                            : 'Sets the time remaining from now, not the total session duration. Package expiry and allowance still apply.'
                    }
                    placeholder={
                        adjustments.timeBank
                            ? 'Enter additional minutes'
                            : 'Enter remaining minutes'
                    }
                    min={1}
                    value={minutes}
                    onChange={setMinutes}
                    disabled={busy !== null}
                />
                <Button
                    onClick={() => void adjust('time')}
                    disabled={!validMinutes || busy === 'fup'}
                    loading={busy === 'time'}
                >
                    {adjustments.timeBank
                        ? 'Add session time'
                        : 'Apply remaining time'}
                </Button>
            </Stack>
            <Divider />
            <Stack gap='xs'>
                <Group justify='space-between'>
                    <Text size='sm' fw={600}>
                        Fair Usage Policy (FUP)
                    </Text>
                    <Badge
                        color={adjustments.fairUsage.active ? 'orange' : 'gray'}
                        variant='light'
                    >
                        {adjustments.fairUsage.forced
                            ? 'Manually activated'
                            : adjustments.fairUsage.active
                              ? 'Active'
                              : 'Not active'}
                    </Badge>
                </Group>
                <Text size='sm' c='dimmed'>
                    {adjustments.fairUsage.available
                        ? `Apply the package's FUP speeds now: ${adjustments.fairUsage.downloadRate === 0 ? 'Unlimited' : `${adjustments.fairUsage.downloadRate} Kbps`} download / ${adjustments.fairUsage.uploadRate === 0 ? 'Unlimited' : `${adjustments.fairUsage.uploadRate} Kbps`} upload. This override lasts until the session ends.`
                        : 'FUP is unavailable. The session needs a linked package with FUP enabled and valid throttled speeds.'}
                </Text>
                <Button
                    color='orange'
                    variant='light'
                    onClick={() => void adjust('fup')}
                    disabled={
                        !adjustments.fairUsage.available ||
                        adjustments.fairUsage.active ||
                        busy === 'time'
                    }
                    loading={busy === 'fup'}
                >
                    Activate FUP
                </Button>
            </Stack>
        </Stack>
    );
}
