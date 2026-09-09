import { DateTimePicker } from '@mantine/dates';
import {
    ActionIcon,
    Avatar,
    Badge,
    Button,
    Card,
    Center,
    CopyButton,
    Divider,
    Drawer,
    Grid,
    Group,
    Loader,
    Modal,
    Stack,
    Table,
    Tabs,
    Text,
    TextInput,
    Textarea,
    Title,
    Tooltip,
} from '@mantine/core';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
    MdBlock,
    MdCheckCircle,
    MdContentCopy,
    MdDelete,
    MdEdit,
    MdFlag,
    MdLockReset,
    MdPowerSettingsNew,
    MdRefresh,
    MdVisibility,
    MdVisibilityOff,
} from 'react-icons/md';

import {
    activateActivation,
    addUserFlag,
    banUser,
    deactivateActivation,
    getAdminUser,
    getUserActivations,
    getUserPayments,
    removeUserFlag,
    setPppoePassword,
    unbanUser,
    updateActivation,
    type AdminActivationRow,
    type AdminUserDetail,
    type UserPaymentRow,
} from '@/lib/api';
import { dayjs } from '@/lib/dayjs';
import {
    formatBytes,
    formatDate,
    formatDateTime,
    formatMoney,
    formatSeconds,
} from '@/lib/format';
import { notifyResult } from '@/lib/notify';

const PAYMENT_BADGE: Record<string, { color: string; label: string }> = {
    paid: { color: 'green', label: 'Paid' },
    pending: { color: 'orange', label: 'Pending' },
    failed: { color: 'red', label: 'Failed' },
};

function StatCard({
    label,
    value,
    sub,
}: {
    label: string;
    value: ReactNode;
    sub?: string;
}) {
    return (
        <Card withBorder padding='md' radius='md'>
            <Text size='xs' c='dimmed'>
                {label}
            </Text>
            <Text size='lg' fw={700} mt={2}>
                {value}
            </Text>
            {sub ? (
                <Text size='xs' c='dimmed' mt={2}>
                    {sub}
                </Text>
            ) : null}
        </Card>
    );
}

export function UserDetailsDrawer({
    userId,
    onClose,
}: {
    userId: string | null;
    onClose: () => void;
}) {
    const [detail, setDetail] = useState<AdminUserDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<string | null>('valuation');
    const [activations, setActivations] = useState<AdminActivationRow[]>([]);
    const [activationsLoading, setActivationsLoading] = useState(false);
    const [payments, setPayments] = useState<UserPaymentRow[]>([]);
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [busy, setBusy] = useState(false);

    // Modal state.
    const [flagModal, setFlagModal] = useState(false);
    const [flagReason, setFlagReason] = useState('');
    const [flagNote, setFlagNote] = useState('');
    const [banModal, setBanModal] = useState(false);
    const [banReason, setBanReason] = useState('');
    const [expiryEdit, setExpiryEdit] = useState<{
        activationId: string;
        current: Date;
    } | null>(null);
    const [expiryValue, setExpiryValue] = useState<Date | null>(null);
    const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(
        null,
    );
    const [pppoeModal, setPppoeModal] = useState(false);
    const [pppoeNewPassword, setPppoeNewPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const loadDetail = useCallback(async (id: string) => {
        setError(null);
        const res = await getAdminUser(id);
        if (!res.success) {
            setError(res.message || 'Failed to load user');
            return;
        }
        if (!res.data) {
            setError('Failed to load user');
            return;
        }
        setDetail(res.data);
    }, []);

    const loadActivations = useCallback(async (id: string) => {
        setActivationsLoading(true);
        const res = await getUserActivations(id);
        setActivationsLoading(false);
        if (res.success && res.data) setActivations(res.data);
    }, []);

    const loadPayments = useCallback(async (id: string) => {
        setPaymentsLoading(true);
        const res = await getUserPayments(id);
        setPaymentsLoading(false);
        if (res.success && res.data) setPayments(res.data);
    }, []);

    useEffect(() => {
        if (!userId) return;
        setDetail(null);
        setError(null);
        setActivations([]);
        setPayments([]);
        setTab('valuation');
        setShowPassword(false);
        void loadDetail(userId);
    }, [userId, loadDetail]);

    useEffect(() => {
        if (!userId || !detail) return;
        if (tab === 'activations') void loadActivations(userId);
        if (tab === 'payments') void loadPayments(userId);
    }, [tab, userId, detail, loadActivations, loadPayments]);

    // --- Actions ---------------------------------------------------------------

    const submitFlag = async () => {
        if (!userId || !flagReason.trim()) return;
        setBusy(true);
        const res = await addUserFlag(userId, {
            reason: flagReason.trim(),
            note: flagNote.trim() || undefined,
        });
        setBusy(false);
        notifyResult(res, 'Flag added');
        if (res.success) {
            setFlagModal(false);
            setFlagReason('');
            setFlagNote('');
            void loadDetail(userId);
        }
    };

    const removeFlag = async (flagId: string) => {
        if (!userId) return;
        const res = await removeUserFlag(userId, flagId);
        notifyResult(res, 'Flag removed');
        if (res.success) void loadDetail(userId);
    };

    const submitBan = async () => {
        if (!userId) return;
        setBusy(true);
        const res = await banUser(userId, {
            reason: banReason.trim() || undefined,
        });
        setBusy(false);
        notifyResult(res, 'User banned');
        if (res.success) {
            setBanModal(false);
            setBanReason('');
            void loadDetail(userId);
        }
    };

    const submitUnban = async () => {
        if (!userId) return;
        setBusy(true);
        const res = await unbanUser(userId);
        setBusy(false);
        notifyResult(res, 'User unbanned');
        if (res.success) void loadDetail(userId);
    };

    const doActivate = async (activationId: string) => {
        if (!userId) return;
        setBusy(true);
        const res = await activateActivation(activationId);
        setBusy(false);
        notifyResult(res, 'Activation restored');
        if (res.success) {
            void loadActivations(userId);
            void loadDetail(userId);
        }
    };

    const doDeactivate = async (activationId: string) => {
        if (!userId) return;
        setBusy(true);
        const res = await deactivateActivation(activationId);
        setBusy(false);
        setConfirmDeactivate(null);
        notifyResult(res, 'Activation deactivated');
        if (res.success) {
            void loadActivations(userId);
            void loadDetail(userId);
        }
    };

    const submitExpiry = async () => {
        if (!userId || !expiryEdit || !expiryValue) return;
        setBusy(true);
        const res = await updateActivation(expiryEdit.activationId, {
            expireAt: expiryValue.toISOString(),
        });
        setBusy(false);
        notifyResult(res, 'Expiry updated');
        if (res.success) {
            setExpiryEdit(null);
            void loadActivations(userId);
            void loadDetail(userId);
        }
    };

    const submitPppoePassword = async () => {
        if (!userId) return;
        setBusy(true);
        const res = await setPppoePassword(
            userId,
            pppoeNewPassword.trim() || undefined,
        );
        setBusy(false);
        notifyResult(
            res,
            res.success && res.data && res.data.sessionsDisconnected > 0
                ? `Password updated; ${res.data.sessionsDisconnected} live session(s) disconnected`
                : 'Password updated',
        );
        if (res.success) {
            setPppoeModal(false);
            setPppoeNewPassword('');
            setShowPassword(true);
            void loadDetail(userId);
        }
    };

    const avgPerPurchase =
        detail && detail.payments.paid > 0
            ? detail.payments.revenue / detail.payments.paid
            : 0;

    return (
        <Drawer
            opened={userId !== null}
            onClose={onClose}
            position='right'
            size='xl'
            title={
                <Title order={4}>
                    {detail?.name ?? detail?.phoneNumber ?? 'User details'}
                </Title>
            }
        >
            {error ? (
                <Text c='red'>{error}</Text>
            ) : !detail ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : (
                <Stack gap='md'>
                    <Group gap='xs' wrap='wrap'>
                        <Avatar src={detail.image} radius='xl' size='md'>
                            {detail.name.slice(0, 1).toUpperCase()}
                        </Avatar>
                        <Stack gap={0}>
                            <Text fw={600}>{detail.name}</Text>
                            <Text size='xs' c='dimmed'>
                                {detail.phoneNumber} · {detail.email}
                            </Text>
                        </Stack>
                        <Group gap='xs' ml='auto'>
                            {detail.online && (
                                <Badge color='green' variant='light'>
                                    Online
                                </Badge>
                            )}
                            {detail.banned ? (
                                <Badge color='red' variant='light'>
                                    Banned
                                </Badge>
                            ) : null}
                            {detail.flags.length > 0 && (
                                <Badge color='orange' variant='light'>
                                    {detail.flags.length} flag
                                    {detail.flags.length > 1 ? 's' : ''}
                                </Badge>
                            )}
                        </Group>
                    </Group>

                    {detail.banned && detail.banReason ? (
                        <Text size='sm' c='red'>
                            Ban reason: {detail.banReason}
                        </Text>
                    ) : null}

                    <Group>
                        <Button
                            size='xs'
                            variant='light'
                            color='orange'
                            leftSection={<MdFlag size={14} />}
                            onClick={() => setFlagModal(true)}
                        >
                            Flag user
                        </Button>
                        {detail.banned ? (
                            <Button
                                size='xs'
                                variant='light'
                                color='green'
                                leftSection={<MdCheckCircle size={14} />}
                                loading={busy}
                                onClick={() => void submitUnban()}
                            >
                                Unban
                            </Button>
                        ) : (
                            <Button
                                size='xs'
                                variant='light'
                                color='red'
                                leftSection={<MdBlock size={14} />}
                                onClick={() => setBanModal(true)}
                            >
                                Ban
                            </Button>
                        )}
                    </Group>

                    <Tabs value={tab} onChange={setTab}>
                        <Tabs.List>
                            <Tabs.Tab value='valuation'>Valuation</Tabs.Tab>
                            <Tabs.Tab value='activations'>
                                Activations ({detail.activations.total})
                            </Tabs.Tab>
                            <Tabs.Tab value='payments'>
                                Payments ({detail.payments.total})
                            </Tabs.Tab>
                            <Tabs.Tab value='pppoe'>PPPoE</Tabs.Tab>
                        </Tabs.List>

                        {/* --- Valuation ------------------------------------- */}
                        <Tabs.Panel value='valuation' pt='md'>
                            <Stack gap='md'>
                                <Grid>
                                    <Grid.Col span={4}>
                                        <StatCard
                                            label='Lifetime spend'
                                            value={formatMoney(
                                                detail.payments.revenue,
                                            )}
                                            sub={`avg ${formatMoney(avgPerPurchase)} per purchase`}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <StatCard
                                            label='Paid purchases'
                                            value={detail.payments.paid}
                                            sub={`${detail.payments.pending} pending · ${detail.payments.failed} failed`}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <StatCard
                                            label='Active activations'
                                            value={detail.activations.active}
                                            sub={`${detail.activations.hotspot} hotspot · ${detail.activations.pppoe} pppoe`}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <StatCard
                                            label='First purchase'
                                            value={
                                                detail.payments.firstAt
                                                    ? formatDate(
                                                          detail.payments.firstAt,
                                                      )
                                                    : '—'
                                            }
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <StatCard
                                            label='Last payment'
                                            value={
                                                detail.payments.lastAt
                                                    ? dayjs(
                                                          detail.payments.lastAt,
                                                      ).fromNow()
                                                    : '—'
                                            }
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <StatCard
                                            label='Data used'
                                            value={formatBytes(
                                                detail.usage.octets,
                                            )}
                                            sub={`${detail.usage.sessions} sessions · ${formatSeconds(detail.usage.seconds)} online`}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <StatCard
                                            label='Registered'
                                            value={formatDate(detail.createdAt)}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <StatCard
                                            label='Last seen'
                                            value={
                                                detail.usage.lastSeen
                                                    ? dayjs(
                                                          detail.usage.lastSeen,
                                                      ).fromNow()
                                                    : 'Never connected'
                                            }
                                        />
                                    </Grid.Col>
                                </Grid>

                                <Divider
                                    label={`Flags (${detail.flags.length})`}
                                    labelPosition='left'
                                />
                                {detail.flags.length === 0 ? (
                                    <Text size='sm' c='dimmed'>
                                        No flags on this user.
                                    </Text>
                                ) : (
                                    <Stack gap='xs'>
                                        {detail.flags.map((flag) => (
                                            <Card
                                                key={flag.id}
                                                withBorder
                                                padding='sm'
                                                radius='md'
                                            >
                                                <Group justify='space-between'>
                                                    <Group gap='xs'>
                                                        <MdFlag color='orange' />
                                                        <Text size='sm' fw={600}>
                                                            {flag.reason}
                                                        </Text>
                                                    </Group>
                                                    <ActionIcon
                                                        variant='subtle'
                                                        color='red'
                                                        aria-label='Remove flag'
                                                        onClick={() =>
                                                            void removeFlag(
                                                                flag.id,
                                                            )
                                                        }
                                                    >
                                                        <MdDelete size={16} />
                                                    </ActionIcon>
                                                </Group>
                                                {flag.note ? (
                                                    <Text size='xs' c='dimmed' mt={4}>
                                                        {flag.note}
                                                    </Text>
                                                ) : null}
                                                <Text size='xs' c='dimmed' mt={4}>
                                                    {formatDateTime(flag.createdAt)}
                                                    {flag.creatorName
                                                        ? ` · by ${flag.creatorName}`
                                                        : ''}
                                                </Text>
                                            </Card>
                                        ))}
                                    </Stack>
                                )}
                            </Stack>
                        </Tabs.Panel>

                        {/* --- Activations ----------------------------------- */}
                        <Tabs.Panel value='activations' pt='md'>
                            {activationsLoading ? (
                                <Center py='md'>
                                    <Loader size='sm' />
                                </Center>
                            ) : activations.length === 0 ? (
                                <Text size='sm' c='dimmed'>
                                    No package activations yet.
                                </Text>
                            ) : (
                                <Table striped withTableBorder>
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th>Package</Table.Th>
                                            <Table.Th>Status</Table.Th>
                                            <Table.Th>Usage</Table.Th>
                                            <Table.Th>Expires</Table.Th>
                                            <Table.Th ta='right'>
                                                Actions
                                            </Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {activations.map((a) => (
                                            <Table.Tr key={a.activationId}>
                                                <Table.Td>
                                                    <Text size='sm' fw={500}>
                                                        {a.packageTitle}
                                                    </Text>
                                                    <Text size='xs' c='dimmed'>
                                                        {a.packageType} ·{' '}
                                                        {a.username}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Group gap={4}>
                                                        {a.online ? (
                                                            <Badge
                                                                color='green'
                                                                variant='light'
                                                                size='sm'
                                                            >
                                                                Online
                                                            </Badge>
                                                        ) : null}
                                                        <Badge
                                                            color={
                                                                a.expired
                                                                    ? 'gray'
                                                                    : 'blue'
                                                            }
                                                            variant='light'
                                                            size='sm'
                                                        >
                                                            {a.expired
                                                                ? 'Expired'
                                                                : 'Active'}
                                                        </Badge>
                                                    </Group>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size='xs'>
                                                        {formatSeconds(
                                                            a.usedSeconds,
                                                        )}{' '}
                                                        /{' '}
                                                        {formatSeconds(
                                                            a.sessionLimitSeconds,
                                                        )}
                                                    </Text>
                                                    <Text size='xs' c='dimmed'>
                                                        {formatBytes(a.octetsUsed)}
                                                        {a.octetsLimit
                                                            ? ` / ${formatBytes(a.octetsLimit)}`
                                                            : ''}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size='xs'>
                                                        {formatDateTime(a.expireAt)}
                                                    </Text>
                                                    <Text size='xs' c='dimmed'>
                                                        {dayjs(
                                                            a.activatedAt,
                                                        ).fromNow()}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Group
                                                        justify='flex-end'
                                                        gap={4}
                                                    >
                                                        {a.expired ? (
                                                            <Tooltip label='Re-activate (restart validity now)'>
                                                                <ActionIcon
                                                                    variant='light'
                                                                    color='green'
                                                                    aria-label='Activate'
                                                                    loading={busy}
                                                                    onClick={() =>
                                                                        void doActivate(
                                                                            a.activationId,
                                                                        )
                                                                    }
                                                                >
                                                                    <MdPowerSettingsNew
                                                                        size={16}
                                                                    />
                                                                </ActionIcon>
                                                            </Tooltip>
                                                        ) : (
                                                            <Tooltip label='Deactivate'>
                                                                <ActionIcon
                                                                    variant='light'
                                                                    color='red'
                                                                    aria-label='Deactivate'
                                                                    onClick={() =>
                                                                        setConfirmDeactivate(
                                                                            a.activationId,
                                                                        )
                                                                    }
                                                                >
                                                                    <MdBlock
                                                                        size={16}
                                                                    />
                                                                </ActionIcon>
                                                            </Tooltip>
                                                        )}
                                                        <Tooltip label='Edit expiry'>
                                                            <ActionIcon
                                                                variant='light'
                                                                aria-label='Edit expiry'
                                                                onClick={() => {
                                                                    setExpiryEdit({
                                                                        activationId:
                                                                            a.activationId,
                                                                        current: new Date(
                                                                            a.expireAt,
                                                                        ),
                                                                    });
                                                                    setExpiryValue(
                                                                        new Date(
                                                                            a.expireAt,
                                                                        ),
                                                                    );
                                                                }}
                                                            >
                                                                <MdEdit size={16} />
                                                            </ActionIcon>
                                                        </Tooltip>
                                                    </Group>
                                                </Table.Td>
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                            )}
                        </Tabs.Panel>

                        {/* --- Payments -------------------------------------- */}
                        <Tabs.Panel value='payments' pt='md'>
                            {paymentsLoading ? (
                                <Center py='md'>
                                    <Loader size='sm' />
                                </Center>
                            ) : payments.length === 0 ? (
                                <Text size='sm' c='dimmed'>
                                    No payments yet.
                                </Text>
                            ) : (
                                <Table striped withTableBorder>
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th>Date</Table.Th>
                                            <Table.Th>Package</Table.Th>
                                            <Table.Th>Amount</Table.Th>
                                            <Table.Th>Status</Table.Th>
                                            <Table.Th>Reference</Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {payments.map((p) => (
                                            <Table.Tr key={p.id}>
                                                <Table.Td>
                                                    <Text size='xs'>
                                                        {formatDateTime(p.createdAt)}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size='sm'>
                                                        {p.packageTitle}
                                                    </Text>
                                                    <Text size='xs' c='dimmed'>
                                                        {p.packageType}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    {formatMoney(p.amount)}
                                                </Table.Td>
                                                <Table.Td>
                                                    <Badge
                                                        size='sm'
                                                        variant='light'
                                                        color={
                                                            PAYMENT_BADGE[
                                                                p.status
                                                            ]?.color ?? 'gray'
                                                        }
                                                    >
                                                        {PAYMENT_BADGE[p.status]
                                                            ?.label ?? p.status}
                                                    </Badge>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size='xs' c='dimmed'>
                                                        {p.providerTransactionId ??
                                                            '—'}
                                                        {p.provider
                                                            ? ` (${p.provider})`
                                                            : ''}
                                                    </Text>
                                                </Table.Td>
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                            )}
                        </Tabs.Panel>

                        {/* --- PPPoE ----------------------------------------- */}
                        <Tabs.Panel value='pppoe' pt='md'>
                            {detail.activations.pppoe === 0 && !detail.pppoe ? (
                                <Text size='sm' c='dimmed'>
                                    This customer has no PPPoE history.
                                </Text>
                            ) : !detail.pppoe ? (
                                <Text size='sm' c='dimmed'>
                                    PPPoE account has no credential provisioned.
                                </Text>
                            ) : (
                                <Stack gap='md'>
                                    <TextInput
                                        label='PPPoE username'
                                        value={detail.pppoe.username}
                                        readOnly
                                        rightSection={
                                            <CopyButton
                                                value={detail.pppoe.username}
                                            >
                                                {({ copy }) => (
                                                    <ActionIcon
                                                        variant='subtle'
                                                        aria-label='Copy username'
                                                        onClick={copy}
                                                    >
                                                            <MdContentCopy size={14} />
                                                    </ActionIcon>
                                                )}
                                            </CopyButton>
                                        }
                                    />
                                    <TextInput
                                        label='PPPoE password'
                                        type={showPassword ? 'text' : 'password'}
                                        value={detail.pppoe.password ?? ''}
                                        readOnly
                                        rightSection={
                                            <Group gap={2}>
                                                <ActionIcon
                                                    variant='subtle'
                                                    aria-label='Toggle password visibility'
                                                    onClick={() =>
                                                        setShowPassword((v) => !v)
                                                    }
                                                >
                                                    {showPassword ? (
                                                        <MdVisibilityOff
                                                            size={14}
                                                        />
                                                    ) : (
                                                        <MdVisibility size={14} />
                                                    )}
                                                </ActionIcon>
                                                <CopyButton
                                                    value={
                                                        detail.pppoe.password ??
                                                        ''
                                                    }
                                                >
                                                    {({ copy }) => (
                                                        <ActionIcon
                                                            variant='subtle'
                                                            aria-label='Copy password'
                                                            onClick={copy}
                                                        >
                                                        <MdContentCopy size={14} />
                                                        </ActionIcon>
                                                    )}
                                                </CopyButton>
                                            </Group>
                                        }
                                    />
                                    <Group>
                                        <Button
                                            size='xs'
                                            variant='light'
                                            leftSection={<MdLockReset size={14} />}
                                            onClick={() => {
                                                setPppoeNewPassword('');
                                                setPppoeModal(true);
                                            }}
                                        >
                                            Change / rotate password
                                        </Button>
                                        <Text size='xs' c='dimmed'>
                                            Changing the password disconnects live
                                            PPP sessions.
                                        </Text>
                                    </Group>
                                </Stack>
                            )}
                        </Tabs.Panel>
                    </Tabs>
                </Stack>
            )}

            {/* --- Modals ------------------------------------------------------ */}

            <Modal
                opened={flagModal}
                onClose={() => setFlagModal(false)}
                title='Flag user'
                centered
            >
                <Stack>
                    <TextInput
                        label='Reason'
                        placeholder='e.g. payment dispute, abuse, suspicious activity'
                        value={flagReason}
                        onChange={(e) => setFlagReason(e.currentTarget.value)}
                        required
                    />
                    <Textarea
                        label='Note (optional)'
                        placeholder='Extra context for other admins'
                        value={flagNote}
                        onChange={(e) => setFlagNote(e.currentTarget.value)}
                        rows={3}
                    />
                    <Button
                        onClick={() => void submitFlag()}
                        disabled={!flagReason.trim()}
                        loading={busy}
                    >
                        Add flag
                    </Button>
                </Stack>
            </Modal>

            <Modal
                opened={banModal}
                onClose={() => setBanModal(false)}
                title='Ban user'
                centered
            >
                <Stack>
                    <Text size='sm' c='dimmed'>
                        Banned users cannot log in to the portals until unbanned.
                    </Text>
                    <Textarea
                        label='Reason (optional)'
                        value={banReason}
                        onChange={(e) => setBanReason(e.currentTarget.value)}
                        rows={2}
                    />
                    <Button
                        color='red'
                        onClick={() => void submitBan()}
                        loading={busy}
                    >
                        Ban user
                    </Button>
                </Stack>
            </Modal>

            <Modal
                opened={expiryEdit !== null}
                onClose={() => setExpiryEdit(null)}
                title='Edit activation expiry'
                centered
            >
                <Stack>
                    <Text size='sm' c='dimmed'>
                        Current expiry:{' '}
                        {expiryEdit ? formatDateTime(expiryEdit.current) : ''}
                    </Text>
                    <DateTimePicker
                        label='New expiry'
                        value={expiryValue}
                        onChange={(v) => setExpiryValue(v ? new Date(v) : null)}
                        clearable
                    />
                    <Button
                        onClick={() => void submitExpiry()}
                        disabled={!expiryValue}
                        loading={busy}
                    >
                        Save expiry
                    </Button>
                </Stack>
            </Modal>

            <Modal
                opened={confirmDeactivate !== null}
                onClose={() => setConfirmDeactivate(null)}
                title='Deactivate activation'
                centered
            >
                <Stack>
                    <Text size='sm'>
                        This removes the RADIUS provisioning and terminates every
                        live session of this activation. The customer keeps the
                        payment record; the package can be re-activated later.
                    </Text>
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            onClick={() => setConfirmDeactivate(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            color='red'
                            loading={busy}
                            leftSection={<MdRefresh size={14} />}
                            onClick={() =>
                                confirmDeactivate &&
                                void doDeactivate(confirmDeactivate)
                            }
                        >
                            Deactivate
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal
                opened={pppoeModal}
                onClose={() => setPppoeModal(false)}
                title='Change PPPoE password'
                centered
            >
                <Stack>
                    <TextInput
                        label='New password (optional)'
                        description='Leave empty to generate a random one. Min 6 characters.'
                        value={pppoeNewPassword}
                        onChange={(e) => setPppoeNewPassword(e.currentTarget.value)}
                    />
                    <Button
                        onClick={() => void submitPppoePassword()}
                        disabled={
                            pppoeNewPassword.trim().length > 0 &&
                            pppoeNewPassword.trim().length < 6
                        }
                        loading={busy}
                    >
                        Save password
                    </Button>
                </Stack>
            </Modal>
        </Drawer>
    );
}
