import {
    Badge,
    Button,
    Divider,
    NumberInput,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { useState } from 'react';

import {
    BANDWIDTH_UNITS,
    BandwidthInput,
    bandwidthKbps,
} from '@/components/BandwidthInput';

import {
    activateSessionFup,
    addSessionBonus,
    editSessionBandwidth,
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
    const [busy, setBusy] = useState<'time' | 'fup' | 'bandwidth' | null>(null);
    const { session, adjustments } = detail;
    const [download, setDownload] = useState<number | string>(
        adjustments.bandwidth ? adjustments.bandwidth.downloadRate / 1_000 : '',
    );
    const [upload, setUpload] = useState<number | string>(
        adjustments.bandwidth ? adjustments.bandwidth.uploadRate / 1_000 : '',
    );
    const [downloadUnit, setDownloadUnit] = useState('mbps');
    const [uploadUnit, setUploadUnit] = useState('mbps');
    const downloadMultiplier = BANDWIDTH_UNITS.find(
        (unit) => unit.value === downloadUnit,
    )!.multiplier;
    const uploadMultiplier = BANDWIDTH_UNITS.find(
        (unit) => unit.value === uploadUnit,
    )!.multiplier;
    const downloadRate = bandwidthKbps(download, downloadMultiplier);
    const uploadRate = bandwidthKbps(upload, uploadMultiplier);
    const validMinutes =
        typeof minutes === 'number' &&
        Number.isFinite(minutes) &&
        minutes >= 1 &&
        Number.isSafeInteger(Math.round(minutes * 60));

    const adjust = async (action: 'time' | 'fup' | 'bandwidth') => {
        if (
            busy ||
            !session.live ||
            (action === 'time' && !validMinutes) ||
            (action === 'bandwidth' &&
                (!adjustments.bandwidth || downloadRate === null || uploadRate === null))
        ) {
            return;
        }
        setBusy(action);
        try {
            const result =
                action === 'bandwidth'
                    ? await editSessionBandwidth(session.radacctId, {
                          downloadRate: downloadRate!,
                          uploadRate: uploadRate!,
                      })
                    : action === 'time'
                      ? await (adjustments.timeBank
                            ? addSessionBonus
                            : editSessionTimeout)(
                            session.radacctId,
                            Math.round(Number(minutes) * 60),
                        )
                      : await activateSessionFup(session.radacctId);
            notifyResult(
                result,
                action === 'bandwidth'
                    ? 'Session bandwidth updated'
                    : action === 'time'
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
                    disabled={
                        !validMinutes || (busy !== null && busy !== 'time')
                    }
                    loading={busy === 'time'}
                >
                    {adjustments.timeBank
                        ? 'Add session time'
                        : 'Apply remaining time'}
                </Button>
            </Stack>
            <Divider
                label={<Title order={5}>Bandwidth</Title>}
                labelPosition='left'
            />
            <Stack gap='xs'>
                <Text size='sm' c='dimmed'>
                    Applies only to this live session until it ends, replacing
                    package speeds and FUP limits. Future connections use the
                    package settings.
                </Text>
                {!adjustments.bandwidth ? (
                    <Text size='sm' c='orange'>
                        Bandwidth settings are unavailable in this API response.
                        Update the API, apply database migrations, then reopen
                        this session.
                    </Text>
                ) : null}
                {adjustments.bandwidth?.overridden ? (
                    <Badge variant='light'>Custom bandwidth active</Badge>
                ) : null}
                <BandwidthInput
                    label='Download bandwidth'
                    value={download}
                    unit={downloadUnit}
                    disabled={busy !== null || !adjustments.bandwidth}
                    onChange={setDownload}
                    onUnitChange={(next) => {
                        if (typeof download === 'number') {
                            setDownload(
                                download * downloadMultiplier /
                                BANDWIDTH_UNITS.find((unit) => unit.value === next)!.multiplier,
                            );
                        }
                        setDownloadUnit(next);
                    }}
                />
                <BandwidthInput
                    label='Upload bandwidth'
                    value={upload}
                    unit={uploadUnit}
                    disabled={busy !== null || !adjustments.bandwidth}
                    onChange={setUpload}
                    onUnitChange={(next) => {
                        if (typeof upload === 'number') {
                            setUpload(
                                upload * uploadMultiplier /
                                BANDWIDTH_UNITS.find((unit) => unit.value === next)!.multiplier,
                            );
                        }
                        setUploadUnit(next);
                    }}
                />
                <Button
                    onClick={() => void adjust('bandwidth')}
                    disabled={
                        !adjustments.bandwidth ||
                        downloadRate === null ||
                        uploadRate === null ||
                        (busy !== null && busy !== 'bandwidth')
                    }
                    loading={busy === 'bandwidth'}
                >
                    Apply bandwidth
                </Button>
                {adjustments.bandwidth && (downloadRate === null || uploadRate === null) ? (
                    <Text size='xs' c='dimmed'>
                        Enter both rates between 0 and 2,147,483,647 Kbps.
                        Positive rates must be at least 1 Kbps.
                    </Text>
                ) : null}
            </Stack>
            <Divider
                label={<Title order={5}>Fair Usage Policy (FUP)</Title>}
                labelPosition='left'
            />
            <Stack gap='xs'>
                <Badge
                    color={
                        !adjustments.bandwidth?.overridden &&
                        adjustments.fairUsage.active
                            ? 'orange'
                            : 'gray'
                    }
                    variant='light'
                >
                    {adjustments.bandwidth?.overridden
                        ? 'Overridden by custom bandwidth'
                        : adjustments.fairUsage.forced
                          ? 'Manually activated'
                          : adjustments.fairUsage.active
                            ? 'Active'
                            : 'Not active'}
                </Badge>
                <Text size='sm' c='dimmed'>
                    {adjustments.fairUsage.available
                        ? `Apply the package's FUP speeds now: ${adjustments.fairUsage.downloadRate === 0 ? 'Unlimited' : `${adjustments.fairUsage.downloadRate} Kbps`} download / ${adjustments.fairUsage.uploadRate === 0 ? 'Unlimited' : `${adjustments.fairUsage.uploadRate} Kbps`} upload. This override lasts until the session ends.`
                        : 'FUP is unavailable. The session needs a linked package with FUP enabled and valid throttled speeds.'}
                    {adjustments.bandwidth?.overridden &&
                    adjustments.fairUsage.available
                        ? ' Activating FUP replaces the custom bandwidth limits.'
                        : ''}
                </Text>
                <Button
                    color='orange'
                    variant='light'
                    onClick={() => void adjust('fup')}
                    disabled={
                        !adjustments.fairUsage.available ||
                        (adjustments.fairUsage.active &&
                            !adjustments.bandwidth?.overridden) ||
                        (busy !== null && busy !== 'fup')
                    }
                    loading={busy === 'fup'}
                >
                    Activate FUP
                </Button>
            </Stack>
        </Stack>
    );
}
