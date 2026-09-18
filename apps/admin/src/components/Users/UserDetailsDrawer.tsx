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
    NumberInput,
    Select,
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
import { useNavigate } from 'react-router-dom';
import {
    MdBlock,
    MdCheckCircle,
    MdClose,
    MdContentCopy,
    MdDelete,
    MdEdit,
    MdFlag,
    MdLockReset,
    MdOpenInNew,
    MdPowerSettingsNew,
    MdRefresh,
    MdSwapHoriz,
    MdVisibility,
    MdVisibilityOff,
    MdWifiTetheringOff,
} from 'react-icons/md';

import {
    activateActivation,
    addUserFlag,
    banUser,
    deactivateActivation,
    disconnectPppoeAccountSessions,
    getAdminUser,
    getNasDevices,
    getUserActivations,
    getUserPayments,
    migratePppoeAccountNas,
    removeUserFlag,
    setPppoeAccountLabel,
    setPppoeAccountStatus,
    setPppoePassword,
    setUserTag,
    unbanUser,
    updateActivation,
    type AdminActivationRow,
    type AdminPppoeAccount,
    type AdminUserDetail,
    type NasDeviceRow,
    type PppoeAccountStatus,
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

const PPPOE_STATUS_BADGE: Record<string, { color: string; label: string }> = {
    active: { color: 'green', label: 'Active' },
    suspended: { color: 'orange', label: 'Suspended' },
    closed: { color: 'gray', label: 'Closed' },
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
        currentRemainingSeconds: number;
    } | null>(null);
    const [expiryValue, setExpiryValue] = useState<Date | null>(null);
    const [remainingMinutes, setRemainingMinutes] = useState<number | string>(0);
    const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(
        null,
    );
    const [selectedPppoeAccountId, setSelectedPppoeAccountId] = useState<
        string | null
    >(null);
    const [pppoeNewPassword, setPppoeNewPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [tagModal, setTagModal] = useState(false);
    const [tagName, setTagName] = useState('');
    const [tagLocation, setTagLocation] = useState('');
    const [pppoeNasModal, setPppoeNasModal] =
        useState<AdminPppoeAccount | null>(null);
    const [nasDevices, setNasDevices] = useState<NasDeviceRow[] | null>(null);
    const [pppoeTargetNasId, setPppoeTargetNasId] = useState<string | null>(
        null,
    );
    const [pppoeStatusModal, setPppoeStatusModal] = useState<{
        account: AdminPppoeAccount;
        status: PppoeAccountStatus;
    } | null>(null);
    const [pppoeDisconnectModal, setPppoeDisconnectModal] =
        useState<AdminPppoeAccount | null>(null);
    const [pppoeLabelModal, setPppoeLabelModal] =
        useState<AdminPppoeAccount | null>(null);
    const [pppoeLabelValue, setPppoeLabelValue] = useState('');
    const navigate = useNavigate();

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
        setSelectedPppoeAccountId(null);
        setTagModal(false);
        setPppoeNasModal(null);
        setPppoeStatusModal(null);
        setPppoeDisconnectModal(null);
        setPppoeLabelModal(null);
        void loadDetail(userId);
    }, [userId, loadDetail]);

    useEffect(() => {
        if (!userId || !detail) return;
        if (tab === 'activations') void loadActivations(userId);
        if (tab === 'payments') void loadPayments(userId);
    }, [tab, userId, detail, loadActivations, loadPayments]);

    // --- Actions ---------------------------------------------------------------

    const openTagModal = () => {
        setTagName(detail?.tag?.name ?? '');
        setTagLocation(detail?.tag?.location ?? '');
        setTagModal(true);
    };

    const submitTag = async () => {
        if (!userId) return;
        setBusy(true);
        const res = await setUserTag(userId, {
            name: tagName.trim() || null,
            location: tagLocation.trim() || null,
        });
        setBusy(false);
        notifyResult(res, 'Customer tag saved');
        if (res.success) {
            setTagModal(false);
            void loadDetail(userId);
        }
    };

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
        if (
            !userId ||
            !expiryEdit ||
            !expiryValue ||
            typeof remainingMinutes !== 'number' ||
            !Number.isFinite(remainingMinutes) ||
            remainingMinutes < 0
        ) {
            return;
        }
        setBusy(true);
        const res = await updateActivation(expiryEdit.activationId, {
            expireAt: expiryValue.toISOString(),
            remainingSeconds: Math.round(remainingMinutes * 60),
        });
        setBusy(false);
        notifyResult(res, 'Activation limits updated');
        if (res.success) {
            setExpiryEdit(null);
            void loadActivations(userId);
            void loadDetail(userId);
        }
    };

    const submitPppoePassword = async () => {
        if (!userId || !selectedPppoeAccountId) return;
        setBusy(true);
        const res = await setPppoePassword(
            selectedPppoeAccountId,
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
            setSelectedPppoeAccountId(null);
            setPppoeNewPassword('');
            setShowPassword(true);
            void loadDetail(userId);
        }
    };

    const openNasModal = (account: AdminPppoeAccount) => {
        setPppoeTargetNasId(account.nasDeviceId);
        setPppoeNasModal(account);
        if (!nasDevices) {
            void (async () => {
                const res = await getNasDevices();
                if (res.success && res.data) setNasDevices(res.data);
            })();
        }
    };

    const submitNasMigration = async () => {
        if (!userId || !pppoeNasModal || !pppoeTargetNasId) return;
        setBusy(true);
        const res = await migratePppoeAccountNas(
            pppoeNasModal.id,
            pppoeTargetNasId,
        );
        setBusy(false);
        notifyResult(
            res,
            res.success && res.data && res.data.sessionsDisconnected > 0
                ? `Moved to the new network; ${res.data.sessionsDisconnected} live session(s) disconnected`
                : 'Moved to the new network',
        );
        if (res.success) {
            setPppoeNasModal(null);
            void loadDetail(userId);
        }
    };

    const submitPppoeStatus = async () => {
        if (!userId || !pppoeStatusModal) return;
        setBusy(true);
        const res = await setPppoeAccountStatus(
            pppoeStatusModal.account.id,
            pppoeStatusModal.status,
        );
        setBusy(false);
        const label =
            pppoeStatusModal.status === 'active'
                ? 'Account reactivated'
                : pppoeStatusModal.status === 'suspended'
                  ? 'Account suspended'
                  : 'Account closed';
        notifyResult(
            res,
            res.success && res.data && res.data.sessionsDisconnected > 0
                ? `${label}; ${res.data.sessionsDisconnected} live session(s) disconnected`
                : label,
        );
        if (res.success) {
            setPppoeStatusModal(null);
            void loadDetail(userId);
        }
    };

    const submitPppoeDisconnect = async () => {
        if (!userId || !pppoeDisconnectModal) return;
        setBusy(true);
        const res = await disconnectPppoeAccountSessions(
            pppoeDisconnectModal.id,
        );
        setBusy(false);
        notifyResult(
            res,
            res.success && res.data && res.data.sessionsDisconnected > 0
                ? `${res.data.sessionsDisconnected} live session(s) disconnected`
                : 'No live sessions to disconnect',
        );
        if (res.success) {
            setPppoeDisconnectModal(null);
            void loadDetail(userId);
        }
    };

    const submitPppoeLabel = async () => {
        if (!userId || !pppoeLabelModal) return;
        setBusy(true);
        const res = await setPppoeAccountLabel(
            pppoeLabelModal.id,
            pppoeLabelValue.trim() || null,
        );
        setBusy(false);
        notifyResult(res, 'Label saved');
        if (res.success) {
            setPppoeLabelModal(null);
            void loadDetail(userId);
        }
    };

    // Deep-links into the payments / sessions logs pre-filtered to one
    // account; closes the drawer so the destination page is visible.
    const viewPppoePayments = (account: AdminPppoeAccount) => {
        onClose();
        navigate(`/payments?pppoeAccountId=${account.id}`);
    };

    const viewPppoeSessions = (account: AdminPppoeAccount) => {
        onClose();
        navigate(`/sessions?q=${encodeURIComponent(account.username)}`);
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
                    {detail?.tag?.name ||
                        detail?.name ||
                        detail?.phoneNumber ||
                        'User details'}
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
                            <Text fw={600}>
                                {detail.tag?.name || detail.name}
                            </Text>
                            <Text size='xs' c='dimmed'>
                                {detail.phoneNumber}
                                {detail.tag?.location
                                    ? ` · ${detail.tag.location}`
                                    : ''}
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

                    {detail.pinResetOtp ? (
                        <Card withBorder padding='sm' radius='md'>
                            <Group justify='space-between' wrap='wrap'>
                                <Group gap='xs'>
                                    <MdLockReset size={16} color='orange' />
                                    <Text size='sm' fw={600}>
                                        Pending PIN reset code
                                    </Text>
                                    <Badge
                                        color='orange'
                                        variant='light'
                                        size='sm'
                                    >
                                        debug
                                    </Badge>
                                </Group>
                                <Group gap={4}>
                                    <Text size='lg' fw={700} ff='monospace'>
                                        {detail.pinResetOtp}
                                    </Text>
                                    <CopyButton value={detail.pinResetOtp}>
                                        {({ copy }) => (
                                            <ActionIcon
                                                variant='subtle'
                                                aria-label='Copy PIN reset code'
                                                onClick={copy}
                                            >
                                                <MdContentCopy size={14} />
                                            </ActionIcon>
                                        )}
                                    </CopyButton>
                                </Group>
                            </Group>
                            <Text size='xs' c='dimmed' mt={4}>
                                SMS delivery is not integrated yet — give this
                                code to the customer so they can complete the
                                forget-PIN flow. Expires{' '}
                                {detail.pinResetOtpExpiresAt
                                    ? dayjs(
                                          detail.pinResetOtpExpiresAt,
                                      ).fromNow()
                                    : 'soon'}
                                .
                            </Text>
                        </Card>
                    ) : null}

                    <Group>
                        <Button
                            size='xs'
                            variant='light'
                            leftSection={<MdEdit size={14} />}
                            onClick={openTagModal}
                        >
                            {detail.tag?.name || detail.tag?.location
                                ? 'Edit name / location'
                                : 'Add name / location'}
                        </Button>
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
                                                                a.deactivated
                                                                    ? 'red'
                                                                    : a.expired
                                                                    ? 'gray'
                                                                    : 'blue'
                                                            }
                                                            variant='light'
                                                            size='sm'
                                                        >
                                                            {a.deactivated
                                                                ? 'Deactivated'
                                                                : a.expired
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
                                                        {formatSeconds(
                                                            a.remainingSeconds ?? 0,
                                                        )}{' '}
                                                        remaining
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
                                                        {a.deactivatedAt
                                                            ? `Deactivated ${dayjs(a.deactivatedAt).fromNow()}`
                                                            : `Activated ${dayjs(a.activatedAt).fromNow()}`}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Group
                                                        justify='flex-end'
                                                        gap={4}
                                                    >
                                                        {a.deactivated ? (
                                                            <Tooltip label='Reactivate with current limits'>
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
                                                        ) : !a.expired ? (
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
                                                        ) : null}
                                                        <Tooltip label='Edit expiry and time remaining'>
                                                            <ActionIcon
                                                                variant='light'
                                                                aria-label='Edit activation limits'
                                                                onClick={() => {
                                                                    setExpiryEdit({
                                                                        activationId:
                                                                            a.activationId,
                                                                        current: new Date(
                                                                            a.expireAt,
                                                                        ),
                                                                        currentRemainingSeconds:
                                                                            a.remainingSeconds ??
                                                                            0,
                                                                    });
                                                                    setExpiryValue(
                                                                        new Date(
                                                                            a.expireAt,
                                                                        ),
                                                                    );
                                                                    setRemainingMinutes(
                                                                        Math.ceil(
                                                                            (a.remainingSeconds ??
                                                                                0) /
                                                                                60,
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
                            {detail.activations.pppoe === 0 &&
                            detail.pppoeAccounts.length === 0 ? (
                                <Text size='sm' c='dimmed'>
                                    This customer has no PPPoE history.
                                </Text>
                            ) : detail.pppoeAccounts.length === 0 ? (
                                <Text size='sm' c='dimmed'>
                                    No PPPoE account credentials have been
                                    provisioned.
                                </Text>
                            ) : (
                                <Stack gap='md'>
                                    {detail.pppoeAccounts.map((account) => {
                                        const status =
                                            PPPOE_STATUS_BADGE[account.status];

                                        return (
                                            <Card
                                                key={account.id}
                                                withBorder
                                                padding='md'
                                                radius='md'
                                            >
                                                <Stack gap='sm'>
                                                    <Group
                                                        justify='space-between'
                                                        align='flex-start'
                                                        wrap='wrap'
                                                    >
                                                        <Stack gap={2}>
                                                            <Text fw={600}>
                                                                {account.label ||
                                                                    'PPPoE account'}
                                                            </Text>
                                                            <Text
                                                                size='xs'
                                                                c='dimmed'
                                                            >
                                                                Network:{' '}
                                                                {account.nasName ??
                                                                    'Unassigned'}
                                                            </Text>
                                                            <Text
                                                                size='xs'
                                                                c='dimmed'
                                                            >
                                                                Last used:{' '}
                                                                {account.lastUsedAt
                                                                    ? formatDateTime(
                                                                          account.lastUsedAt,
                                                                      )
                                                                    : 'Never'}
                                                            </Text>
                                                        </Stack>
                                                        <Badge
                                                            color={
                                                                status?.color ??
                                                                'gray'
                                                            }
                                                            variant='light'
                                                        >
                                                            {status?.label ??
                                                                account.status}
                                                        </Badge>
                                                    </Group>

                                                    <TextInput
                                                        label='PPPoE username'
                                                        value={account.username}
                                                        readOnly
                                                        rightSection={
                                                            <CopyButton
                                                                value={
                                                                    account.username
                                                                }
                                                            >
                                                                {({ copy }) => (
                                                                    <ActionIcon
                                                                        variant='subtle'
                                                                        aria-label={`Copy username for ${account.label || account.username}`}
                                                                        onClick={copy}
                                                                    >
                                                                        <MdContentCopy
                                                                            size={14}
                                                                        />
                                                                    </ActionIcon>
                                                                )}
                                                            </CopyButton>
                                                        }
                                                    />
                                                    <TextInput
                                                        label='PPPoE password'
                                                        type={
                                                            showPassword
                                                                ? 'text'
                                                                : 'password'
                                                        }
                                                        value={
                                                            account.password ?? ''
                                                        }
                                                        placeholder='Not provisioned'
                                                        readOnly
                                                        rightSectionWidth={68}
                                                        rightSection={
                                                            <Group gap={2}>
                                                                <ActionIcon
                                                                    variant='subtle'
                                                                    aria-label={`${showPassword ? 'Hide' : 'Show'} password for ${account.label || account.username}`}
                                                                    disabled={
                                                                        !account.password
                                                                    }
                                                                    onClick={() =>
                                                                        setShowPassword(
                                                                            (v) =>
                                                                                !v,
                                                                        )
                                                                    }
                                                                >
                                                                    {showPassword ? (
                                                                        <MdVisibilityOff
                                                                            size={14}
                                                                        />
                                                                    ) : (
                                                                        <MdVisibility
                                                                            size={14}
                                                                        />
                                                                    )}
                                                                </ActionIcon>
                                                                <CopyButton
                                                                    value={
                                                                        account.password ??
                                                                        ''
                                                                    }
                                                                >
                                                                    {({ copy }) => (
                                                                        <ActionIcon
                                                                            variant='subtle'
                                                                            aria-label={`Copy password for ${account.label || account.username}`}
                                                                            disabled={
                                                                                !account.password
                                                                            }
                                                                            onClick={
                                                                                copy
                                                                            }
                                                                        >
                                                                            <MdContentCopy
                                                                                size={14}
                                                                            />
                                                                        </ActionIcon>
                                                                    )}
                                                                </CopyButton>
                                                            </Group>
                                                        }
                                                    />
                                                    <Stack gap={6}>
                                                        <Group
                                                            gap='xs'
                                                            wrap='wrap'
                                                        >
                                                            <Button
                                                                size='xs'
                                                                variant='light'
                                                                leftSection={
                                                                    <MdLockReset
                                                                        size={14}
                                                                    />
                                                                }
                                                                onClick={() => {
                                                                    setPppoeNewPassword(
                                                                        '',
                                                                    );
                                                                    setSelectedPppoeAccountId(
                                                                        account.id,
                                                                    );
                                                                }}
                                                            >
                                                                Change / rotate
                                                                password
                                                            </Button>
                                                            <Button
                                                                size='xs'
                                                                variant='light'
                                                                leftSection={
                                                                    <MdSwapHoriz
                                                                        size={14}
                                                                    />
                                                                }
                                                                onClick={() =>
                                                                    openNasModal(
                                                                        account,
                                                                    )
                                                                }
                                                            >
                                                                Reassign network
                                                            </Button>
                                                            <Button
                                                                size='xs'
                                                                variant='light'
                                                                leftSection={
                                                                    <MdEdit
                                                                        size={14}
                                                                    />
                                                                }
                                                                onClick={() => {
                                                                    setPppoeLabelValue(
                                                                        account.label ??
                                                                            '',
                                                                    );
                                                                    setPppoeLabelModal(
                                                                        account,
                                                                    );
                                                                }}
                                                            >
                                                                Edit label
                                                            </Button>
                                                            <Button
                                                                size='xs'
                                                                variant='light'
                                                                leftSection={
                                                                    <MdWifiTetheringOff
                                                                        size={14}
                                                                    />
                                                                }
                                                                onClick={() =>
                                                                    setPppoeDisconnectModal(
                                                                        account,
                                                                    )
                                                                }
                                                            >
                                                                Disconnect sessions
                                                            </Button>
                                                            {account.status ===
                                                            'active' ? (
                                                                <>
                                                                    <Button
                                                                        size='xs'
                                                                        variant='light'
                                                                        color='orange'
                                                                        leftSection={
                                                                            <MdBlock
                                                                                size={14}
                                                                            />
                                                                        }
                                                                        onClick={() =>
                                                                            setPppoeStatusModal(
                                                                                {
                                                                                    account,
                                                                                    status: 'suspended',
                                                                                },
                                                                            )
                                                                        }
                                                                    >
                                                                        Suspend
                                                                    </Button>
                                                                    <Button
                                                                        size='xs'
                                                                        variant='light'
                                                                        color='red'
                                                                        leftSection={
                                                                            <MdClose
                                                                                size={14}
                                                                            />
                                                                        }
                                                                        onClick={() =>
                                                                            setPppoeStatusModal(
                                                                                {
                                                                                    account,
                                                                                    status: 'closed',
                                                                                },
                                                                            )
                                                                        }
                                                                    >
                                                                        Close
                                                                    </Button>
                                                                </>
                                                            ) : (
                                                                <Button
                                                                    size='xs'
                                                                    variant='light'
                                                                    color='green'
                                                                    leftSection={
                                                                        <MdCheckCircle
                                                                            size={14}
                                                                        />
                                                                    }
                                                                    onClick={() =>
                                                                        setPppoeStatusModal(
                                                                            {
                                                                                account,
                                                                                status: 'active',
                                                                            },
                                                                        )
                                                                    }
                                                                >
                                                                    Reactivate
                                                                </Button>
                                                            )}
                                                            <Button
                                                                size='xs'
                                                                variant='subtle'
                                                                rightSection={
                                                                    <MdOpenInNew
                                                                        size={14}
                                                                    />
                                                                }
                                                                onClick={() =>
                                                                    viewPppoePayments(
                                                                        account,
                                                                    )
                                                                }
                                                            >
                                                                View payments
                                                            </Button>
                                                            <Button
                                                                size='xs'
                                                                variant='subtle'
                                                                rightSection={
                                                                    <MdOpenInNew
                                                                        size={14}
                                                                    />
                                                                }
                                                                onClick={() =>
                                                                    viewPppoeSessions(
                                                                        account,
                                                                    )
                                                                }
                                                            >
                                                                View sessions
                                                            </Button>
                                                        </Group>
                                                        <Text
                                                            size='xs'
                                                            c='dimmed'
                                                        >
                                                            Rotating the
                                                            password, reassigning
                                                            the network,
                                                            suspending or closing
                                                            the account all
                                                            disconnect its live
                                                            PPP sessions.
                                                        </Text>
                                                    </Stack>
                                                </Stack>
                                            </Card>
                                        );
                                    })}
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
                title='Edit activation limits'
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
                    <NumberInput
                        label='Time remaining (minutes)'
                        description={
                            expiryEdit
                                ? `Currently ${formatSeconds(expiryEdit.currentRemainingSeconds)}`
                                : undefined
                        }
                        min={0}
                        allowDecimal={false}
                        value={remainingMinutes}
                        onChange={setRemainingMinutes}
                    />
                    <Button
                        onClick={() => void submitExpiry()}
                        disabled={
                            !expiryValue ||
                            typeof remainingMinutes !== 'number' ||
                            remainingMinutes < 0
                        }
                        loading={busy}
                    >
                        Save limits
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
                        live session of this activation. Expiry and remaining
                        time are preserved, but the package is hidden from the
                        customer until it is reactivated.
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
                opened={tagModal}
                onClose={() => setTagModal(false)}
                title='Customer name / location'
                centered
            >
                <Stack>
                    <Text size='sm' c='dimmed'>
                        Private labels only visible to you. The customer's
                        phone-number identity is unchanged; both fields are
                        optional and can be updated later.
                    </Text>
                    <TextInput
                        label='Name'
                        placeholder='e.g. Jane Mwangi'
                        value={tagName}
                        onChange={(e) => setTagName(e.currentTarget.value)}
                        maxLength={80}
                    />
                    <TextInput
                        label='Location'
                        placeholder='e.g. Riverside Apartments, House 4B'
                        value={tagLocation}
                        onChange={(e) => setTagLocation(e.currentTarget.value)}
                        maxLength={120}
                    />
                    <Button onClick={() => void submitTag()} loading={busy}>
                        Save tag
                    </Button>
                </Stack>
            </Modal>

            <Modal
                opened={selectedPppoeAccountId !== null}
                onClose={() => setSelectedPppoeAccountId(null)}
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

            <Modal
                opened={pppoeNasModal !== null}
                onClose={() => setPppoeNasModal(null)}
                title='Reassign PPPoE network'
                centered
            >
                <Stack>
                    <Text size='sm' c='dimmed'>
                        The account keeps its username, password and package
                        history, but dials through the new router. Live PPP
                        sessions are cut so the customer reconnects on the new
                        network.
                    </Text>
                    <Select
                        label='NAS device'
                        placeholder={
                            nasDevices === null ? 'Loading devices…' : 'Pick a network'
                        }
                        data={(nasDevices ?? []).map((device) => ({
                            value: device.id,
                            label: device.location
                                ? `${device.name} — ${device.location}`
                                : device.name,
                        }))}
                        value={pppoeTargetNasId}
                        onChange={setPppoeTargetNasId}
                        searchable
                    />
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            onClick={() => setPppoeNasModal(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            loading={busy}
                            disabled={
                                !pppoeTargetNasId ||
                                pppoeTargetNasId === pppoeNasModal?.nasDeviceId
                            }
                            onClick={() => void submitNasMigration()}
                        >
                            Move account
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal
                opened={pppoeStatusModal !== null}
                onClose={() => setPppoeStatusModal(null)}
                title={
                    pppoeStatusModal?.status === 'active'
                        ? 'Reactivate PPPoE account'
                        : pppoeStatusModal?.status === 'suspended'
                          ? 'Suspend PPPoE account'
                          : 'Close PPPoE account'
                }
                centered
            >
                <Stack>
                    <Text size='sm'>
                        {pppoeStatusModal?.status === 'active'
                            ? 'The account can dial in and buy packages again. Nothing is reconnected automatically — the customer re-dials with the same credentials.'
                            : pppoeStatusModal?.status === 'suspended'
                              ? 'The account is rejected at RADIUS and hidden from portal purchases until you reactivate it. Live PPP sessions are disconnected now. Use this for temporary blocks (e.g. payment disputes).'
                              : 'The account is rejected at RADIUS and hidden from portal purchases. Closing is meant to be permanent — prefer suspend for temporary blocks. Live PPP sessions are disconnected now.'}
                    </Text>
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            onClick={() => setPppoeStatusModal(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            loading={busy}
                            color={
                                pppoeStatusModal?.status === 'active'
                                    ? 'green'
                                    : pppoeStatusModal?.status === 'suspended'
                                      ? 'orange'
                                      : 'red'
                            }
                            onClick={() => void submitPppoeStatus()}
                        >
                            {pppoeStatusModal?.status === 'active'
                                ? 'Reactivate'
                                : pppoeStatusModal?.status === 'suspended'
                                  ? 'Suspend'
                                  : 'Close'}
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal
                opened={pppoeDisconnectModal !== null}
                onClose={() => setPppoeDisconnectModal(null)}
                title='Disconnect PPPoE sessions'
                centered
            >
                <Stack>
                    <Text size='sm'>
                        Sends a RADIUS Disconnect-Request for every live session
                        of {pppoeDisconnectModal?.username}. The account and its
                        packages are untouched; the customer can re-dial
                        immediately.
                    </Text>
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            onClick={() => setPppoeDisconnectModal(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            color='red'
                            loading={busy}
                            onClick={() => void submitPppoeDisconnect()}
                        >
                            Disconnect
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal
                opened={pppoeLabelModal !== null}
                onClose={() => setPppoeLabelModal(null)}
                title='Edit PPPoE account label'
                centered
            >
                <Stack>
                    <Text size='sm' c='dimmed'>
                        Private name for this line, only visible to you. Leave
                        empty to clear it.
                    </Text>
                    <TextInput
                        label='Label'
                        placeholder='e.g. Home line, Shop router'
                        value={pppoeLabelValue}
                        onChange={(e) => setPppoeLabelValue(e.currentTarget.value)}
                        maxLength={80}
                    />
                    <Button onClick={() => void submitPppoeLabel()} loading={busy}>
                        Save label
                    </Button>
                </Stack>
            </Modal>
        </Drawer>
    );
}
