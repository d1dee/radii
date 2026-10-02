import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Center,
    Checkbox,
    CopyButton,
    Group,
    Loader,
    Modal,
    SegmentedControl,
    Select,
    SimpleGrid,
    Stack,
    Table,
    Text,
    Textarea,
    TextInput,
    Title,
    Tooltip,
    UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { PhoneNumberInput } from '@radii/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    MdAdd,
    MdBlock,
    MdCheck,
    MdCheckCircle,
    MdContentCopy,
    MdEdit,
    MdFlag,
    MdSearch,
} from 'react-icons/md';

import { PageLayout } from '@/components/Layout/PageLayout';
import { PageTableScrollContainer } from '@/components/PageTableScrollContainer';
import {
    SortableTableHeader,
    type SortDirection,
} from '@/components/SortableTableHeader';
import { TableFilters } from '@/components/TableFilters';
import { TablePagination } from '@/components/TablePagination';
import { UserDetailsDrawer } from '@/components/Users/UserDetailsDrawer';
import {
    addUserFlag,
    banUser,
    getAdminUsers,
    getAllNasDevices,
    getPppoeAccount,
    migratePppoeAccountNas,
    provisionPppoeAccount,
    setUserTag,
    unbanUser,
    type AdminUserList,
    type AdminUserRow,
    type AdminUserSortKey,
    type NasDeviceRow,
    type PackageType,
    type PppoeAccountDetail,
    type ProvisionedPppoeAccount,
} from '@/lib/api';
import { useAutoRefresh } from '@/lib/autoRefresh';
import { warnBackgroundFailure } from '@/lib/clientError';
import { dayjs } from '@/lib/dayjs';
import { formatDate, formatMoney } from '@/lib/format';
import { notifyResult } from '@/lib/notify';
import { useAdminSettings } from '@/lib/settings';

type TypeFilter = 'all' | PackageType;

function SummaryCard({ label, value }: { label: string; value: string }) {
    return (
        <Card withBorder padding='md' radius='md'>
            <Text size='xs' c='dimmed'>
                {label}
            </Text>
            <Text
                size='lg'
                fw={700}
                mt={2}
                style={{ overflowWrap: 'anywhere' }}
            >
                {value}
            </Text>
        </Card>
    );
}

function CredentialField({ label, value }: { label: string; value: string }) {
    return (
        <TextInput
            label={label}
            value={value}
            readOnly
            styles={{ input: { fontFamily: 'monospace' } }}
            rightSection={
                <CopyButton value={value} timeout={1500}>
                    {({ copied, copy }) => (
                        <ActionIcon
                            variant='subtle'
                            color={copied ? 'green' : 'gray'}
                            onClick={copy}
                            aria-label={`Copy ${label.toLowerCase()}`}
                        >
                            {copied ? <MdCheck /> : <MdContentCopy />}
                        </ActionIcon>
                    )}
                </CopyButton>
            }
        />
    );
}

export default function UsersPage() {
    const { settings, loaded } = useAdminSettings();
    const perPage = settings.dashboard.perPage;
    const [data, setData] = useState<AdminUserList | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search, 300);
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [flaggedOnly, setFlaggedOnly] = useState(false);
    const [sortBy, setSortBy] = useState<AdminUserSortKey>('createdAt');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [page, setPage] = useState(1);
    const loadRequest = useRef(0);
    const [detailsId, setDetailsId] = useState<string | null>(null);
    const [nasDevices, setNasDevices] = useState<NasDeviceRow[]>([]);
    const [provisionOpened, setProvisionOpened] = useState(false);
    const [provisionPhone, setProvisionPhone] = useState('');
    const [provisionNas, setProvisionNas] = useState<string | null>(null);
    const [provisionLabel, setProvisionLabel] = useState('');
    const [provisioning, setProvisioning] = useState(false);
    const [provisionError, setProvisionError] = useState<string | null>(null);
    const [provisioned, setProvisioned] =
        useState<ProvisionedPppoeAccount | null>(null);
    const [migrateNas, setMigrateNas] = useState<string | null>(null);
    const [migrating, setMigrating] = useState(false);
    const [detailsAccountId, setDetailsAccountId] = useState<string | null>(
        null,
    );
    const [accountDetails, setAccountDetails] =
        useState<PppoeAccountDetail | null>(null);
    const [accountDetailsLoading, setAccountDetailsLoading] = useState(false);
    const [regenerated, setRegenerated] =
        useState<ProvisionedPppoeAccount | null>(null);
    const [regenerating, setRegenerating] = useState(false);
    const [quickUser, setQuickUser] = useState<AdminUserRow | null>(null);
    const [quickModal, setQuickModal] = useState<
        'edit' | 'flag' | 'ban' | null
    >(null);
    const [quickBusy, setQuickBusy] = useState(false);
    const [tagName, setTagName] = useState('');
    const [tagLocation, setTagLocation] = useState('');
    const [flagReason, setFlagReason] = useState('');
    const [flagNote, setFlagNote] = useState('');
    const [banReason, setBanReason] = useState('');

    useEffect(() => {
        void (async () => {
            const res = await getAllNasDevices();
            if (res.success && res.data) setNasDevices(res.data);
            else warnBackgroundFailure('load user NAS options', res);
        })();
    }, []);

    const nasOptions = nasDevices.map((device) => ({
        value: device.id,
        label: device.location
            ? `${device.name} · ${device.location}`
            : device.name,
    }));

    useEffect(() => {
        if (!detailsAccountId) {
            setAccountDetails(null);
            setRegenerated(null);
            setMigrateNas(null);
            return;
        }
        let cancelled = false;
        setAccountDetailsLoading(true);
        void (async () => {
            const res = await getPppoeAccount(detailsAccountId);
            if (cancelled) return;
            setAccountDetailsLoading(false);
            if (!res.success) {
                notifications.show({
                    color: 'red',
                    title: 'Could not load account',
                    message: res.message || 'PPPoE account not found',
                });
                setDetailsAccountId(null);
                return;
            }
            if (!res.data) {
                notifications.show({
                    color: 'red',
                    title: 'Could not load account',
                    message: 'PPPoE account not found',
                });
                setDetailsAccountId(null);
                return;
            }
            setAccountDetails(res.data);
            setMigrateNas(res.data.nasDeviceId);
        })();
        return () => {
            cancelled = true;
        };
    }, [detailsAccountId]);

    async function regenerateClaim() {
        if (!accountDetails) return;
        if (!accountDetails.nasDeviceId) {
            notifications.show({
                color: 'red',
                title: 'No network assigned',
                message:
                    'This account has no NAS device yet; migrate it to one first.',
            });
            return;
        }
        setRegenerating(true);
        const result = await provisionPppoeAccount({
            phoneNumber: accountDetails.phoneNumber,
            nasDeviceId: accountDetails.nasDeviceId,
            label: accountDetails.label ?? undefined,
        });
        setRegenerating(false);
        if (!result.success) {
            notifications.show({
                color: 'red',
                title: 'Could not regenerate credentials',
                message: result.message || 'Please try again',
            });
            return;
        }
        if (!result.data) {
            notifications.show({
                color: 'red',
                title: 'Could not regenerate credentials',
                message: 'Please try again',
            });
            return;
        }
        setRegenerated(result.data);
        notifications.show({
            color: 'green',
            title: 'Credentials regenerated',
            message: 'Share the new claim code with the customer.',
        });
        void load(page, true);
    }

    async function submitMigrate() {
        if (!accountDetails || !migrateNas) return;
        if (migrateNas === accountDetails.nasDeviceId) return;
        setMigrating(true);
        const result = await migratePppoeAccountNas(
            accountDetails.id,
            migrateNas,
        );
        setMigrating(false);
        if (!result.success) {
            notifications.show({
                color: 'red',
                title: 'Could not migrate account',
                message: result.message || 'Please try again',
            });
            return;
        }
        notifications.show({
            color: 'green',
            title: 'Account migrated',
            message: 'The account now belongs to the selected network.',
        });
        const refreshed = await getPppoeAccount(accountDetails.id);
        if (refreshed.success && refreshed.data) {
            setAccountDetails(refreshed.data);
        } else {
            warnBackgroundFailure('refresh migrated PPPoE account', refreshed);
        }
        void load(page, true);
    }

    const load = useCallback(
        async (pageToLoad: number, silent = false) => {
            const requestId = ++loadRequest.current;
            if (!silent) {
                setLoading(true);
                setError(null);
            }
            const res = await getAdminUsers({
                q: debouncedSearch.trim() || undefined,
                type: typeFilter === 'all' ? undefined : typeFilter,
                flagged: flaggedOnly || undefined,
                sortBy,
                sortDirection,
                page: pageToLoad,
                perPage,
            });
            if (requestId !== loadRequest.current) return;
            if (!silent) setLoading(false);
            if (!res.success) {
                if (silent) warnBackgroundFailure('refresh users', res);
                else setError(res.message || 'Failed to load users');
                return;
            }
            if (!res.data) {
                if (silent) warnBackgroundFailure('refresh users', res);
                else setError('Failed to load users');
                return;
            }
            setError(null);
            setData(res.data);
        },
        [
            debouncedSearch,
            typeFilter,
            flaggedOnly,
            sortBy,
            sortDirection,
            perPage,
        ],
    );

    useEffect(() => {
        setPage(1);
    }, [
        debouncedSearch,
        typeFilter,
        flaggedOnly,
        sortBy,
        sortDirection,
        perPage,
    ]);

    const handleSort = (key: AdminUserSortKey, direction: SortDirection) => {
        setSortBy(key);
        setSortDirection(direction);
    };

    useEffect(() => {
        if (!loaded) return;
        void load(page);
    }, [loaded, load, page]);

    useAutoRefresh(() => void load(page, true), loaded);

    const summary = useMemo(() => {
        const users = data?.users ?? [];
        const online = users.filter((user) => user.online).length;
        const flagged = users.filter((user) => user.flags > 0).length;
        const revenue = users.reduce(
            (sum, user) => sum + Number(user.payments.revenue),
            0,
        );

        return { online, flagged, revenue };
    }, [data]);

    function openProvision() {
        setProvisionPhone('');
        setProvisionNas(
            nasDevices.length === 1 ? nasDevices[0]!.id : provisionNas,
        );
        setProvisionLabel('');
        setProvisionError(null);
        setProvisioned(null);
        setProvisionOpened(true);
    }

    function openQuickAction(
        user: AdminUserRow,
        modal: 'edit' | 'flag' | 'ban',
    ) {
        setQuickUser(user);
        setQuickModal(modal);
        setTagName(user.tag?.name ?? '');
        setTagLocation(user.tag?.location ?? '');
        setFlagReason('');
        setFlagNote('');
        setBanReason('');
    }

    function closeQuickAction() {
        setQuickModal(null);
        setQuickUser(null);
    }

    async function submitQuickTag() {
        if (!quickUser) return;
        setQuickBusy(true);
        const res = await setUserTag(quickUser.id, {
            name: tagName.trim() || null,
            location: tagLocation.trim() || null,
        });
        setQuickBusy(false);
        notifyResult(res, 'Customer tag saved');
        if (!res.success) return;
        closeQuickAction();
        void load(page, true);
    }

    async function submitQuickFlag() {
        if (!quickUser || !flagReason.trim()) return;
        setQuickBusy(true);
        const res = await addUserFlag(quickUser.id, {
            reason: flagReason.trim(),
            note: flagNote.trim() || undefined,
        });
        setQuickBusy(false);
        notifyResult(res, 'Flag added');
        if (!res.success) return;
        closeQuickAction();
        void load(page, true);
    }

    async function submitQuickBan() {
        if (!quickUser) return;
        setQuickBusy(true);
        const res = await banUser(quickUser.id, {
            reason: banReason.trim() || undefined,
        });
        setQuickBusy(false);
        notifyResult(res, 'User banned');
        if (!res.success) return;
        closeQuickAction();
        void load(page, true);
    }

    async function submitQuickUnban(user: AdminUserRow) {
        setQuickBusy(true);
        const res = await unbanUser(user.id);
        setQuickBusy(false);
        notifyResult(res, 'User unbanned');
        if (!res.success) return;
        void load(page, true);
    }

    async function submitProvision(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!provisionNas) {
            setProvisionError('Select the NAS device for this account');
            return;
        }
        setProvisionError(null);
        setProvisioning(true);
        const result = await provisionPppoeAccount({
            phoneNumber: provisionPhone,
            nasDeviceId: provisionNas,
            label: provisionLabel.trim() || undefined,
        });
        setProvisioning(false);
        if (!result.success) {
            setProvisionError(
                result.message || 'Could not provision PPPoE credentials',
            );
            return;
        }
        if (!result.data) {
            setProvisionError('Could not provision PPPoE credentials');
            return;
        }
        setProvisioned(result.data);
        notifications.show({
            color: 'green',
            title: 'PPPoE credentials provisioned',
            message: result.data.linked
                ? 'Linked to the existing customer account.'
                : 'Share the credentials and claim code with the customer.',
        });
        void load(page, true);
    }

    return (
        <PageLayout
            label='Users page content'
            header={
                <Group justify='space-between' wrap='nowrap'>
                    <Stack gap={4}>
                        <Title order={3}>Users</Title>
                        <Text size='sm' c='dimmed'>
                            Customers registered through your portals, with
                            spend and activation history.
                        </Text>
                    </Stack>
                    <Button
                        leftSection={<MdAdd />}
                        onClick={openProvision}
                        visibleFrom='md'
                    >
                        Provision PPPoE
                    </Button>
                    <Button
                        leftSection={<MdAdd />}
                        onClick={openProvision}
                        hiddenFrom='md'
                        size='xs'
                        w='150'
                    >
                        PPPoE
                    </Button>
                </Group>
            }
        >
            {!loading && !error && data && (
                <SimpleGrid cols={{ base: 2, lg: 4 }}>
                    <SummaryCard
                        label='Customers (filtered)'
                        value={String(data.total)}
                    />
                    <SummaryCard
                        label='Online on page'
                        value={String(summary.online)}
                    />
                    <SummaryCard
                        label='Flagged on page'
                        value={String(summary.flagged)}
                    />
                    <SummaryCard
                        label='Lifetime spend on page'
                        value={formatMoney(summary.revenue)}
                    />
                </SimpleGrid>
            )}

            <TableFilters
                search={
                    <TextInput
                        aria-label='Search users'
                        placeholder='Search name, phone or email'
                        leftSection={<MdSearch />}
                        value={search}
                        onChange={(e) => setSearch(e.currentTarget.value)}
                        w={{ base: '100%', sm: 'auto' }}
                        style={{ flex: '1 1 220px', minWidth: 0 }}
                    />
                }
            >
                <SegmentedControl
                    aria-label='Filter users by service type'
                    value={typeFilter}
                    onChange={(v) => setTypeFilter(v as TypeFilter)}
                    data={[
                        { value: 'all', label: 'All' },
                        { value: 'hotspot', label: 'Hotspot' },
                        { value: 'pppoe', label: 'PPPoE' },
                    ]}
                />
                <Checkbox
                    label='Flagged only'
                    checked={flaggedOnly}
                    onChange={(e) => setFlaggedOnly(e.currentTarget.checked)}
                />
            </TableFilters>

            {loading ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : error ? (
                <Text c='red'>{error}</Text>
            ) : !data || data.users.length === 0 ? (
                <Text c='dimmed' py='xl' ta='center'>
                    No users match.
                </Text>
            ) : (
                <>
                    <PageTableScrollContainer
                        minWidth={900}
                        aria-label='Users table'
                    >
                        <Table striped highlightOnHover stickyHeader>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>#</Table.Th>
                                    <SortableTableHeader
                                        label='User'
                                        width={240}
                                        sortKey='name'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                    />
                                    <Table.Th miw={120}>Status</Table.Th>
                                    <SortableTableHeader
                                        label='Lifetime spend'
                                        sortKey='revenue'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                        initialDirection='desc'
                                    />
                                    <SortableTableHeader
                                        label='Payments'
                                        sortKey='payments'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                        initialDirection='desc'
                                    />
                                    <SortableTableHeader
                                        label='Activations'
                                        sortKey='activations'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                        initialDirection='desc'
                                    />
                                    <SortableTableHeader
                                        label='Last payment'
                                        sortKey='lastPaymentAt'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                        initialDirection='desc'
                                    />
                                    <SortableTableHeader
                                        label='Registered'
                                        sortKey='createdAt'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                        initialDirection='desc'
                                    />
                                    <Table.Th ta='right'>Actions</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {data.users.map((u, i) => (
                                    <Table.Tr
                                        key={u.id}
                                        onClick={
                                            u.pendingClaim
                                                ? () =>
                                                      setDetailsAccountId(u.id)
                                                : () => setDetailsId(u.id)
                                        }
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <Table.Td>
                                            {(page - 1) * perPage + i + 1}
                                        </Table.Td>
                                        <Table.Td className='admin-table-identity'>
                                            <UnstyledButton
                                                fw={500}
                                                fz='sm'
                                                aria-label={`View details for ${u.tag?.name || u.name}`}
                                            >
                                                {u.tag?.name || u.name}
                                            </UnstyledButton>
                                            <Text size='xs' c='dimmed'>
                                                {u.phoneNumber}
                                                {u.tag?.location
                                                    ? ` · ${u.tag.location}`
                                                    : ''}
                                            </Text>
                                            {u.pendingClaim && u.pppoe ? (
                                                <Text
                                                    size='xs'
                                                    c='dimmed'
                                                    ff='monospace'
                                                >
                                                    {u.pppoe.username}
                                                </Text>
                                            ) : null}
                                            {u.pendingClaim &&
                                            u.pppoe?.nasName ? (
                                                <Text size='xs' c='dimmed'>
                                                    {u.pppoe.nasName}
                                                </Text>
                                            ) : null}
                                        </Table.Td>
                                        <Table.Td>
                                            <Group gap={4}>
                                                {u.pendingClaim ? (
                                                    <Badge
                                                        color='violet'
                                                        variant='light'
                                                        size='sm'
                                                    >
                                                        Pending claim
                                                    </Badge>
                                                ) : null}
                                                {u.online ? (
                                                    <Badge
                                                        color='green'
                                                        variant='light'
                                                        size='sm'
                                                    >
                                                        Online
                                                    </Badge>
                                                ) : null}
                                                {u.banned ? (
                                                    <Badge
                                                        color='red'
                                                        variant='light'
                                                        size='sm'
                                                    >
                                                        Banned
                                                    </Badge>
                                                ) : null}
                                                {u.flags > 0 ? (
                                                    <Badge
                                                        color='orange'
                                                        variant='light'
                                                        size='sm'
                                                    >
                                                        {u.flags} flag
                                                        {u.flags > 1 ? 's' : ''}
                                                    </Badge>
                                                ) : null}
                                                {u.activations.underFup > 0 ? (
                                                    <Badge
                                                        color='orange'
                                                        variant='filled'
                                                        size='sm'
                                                    >
                                                        Under FUP
                                                        {u.activations
                                                            .underFup > 1
                                                            ? ` (${u.activations.underFup})`
                                                            : ''}
                                                    </Badge>
                                                ) : null}
                                            </Group>
                                        </Table.Td>
                                        <Table.Td className='admin-table-value'>
                                            {formatMoney(u.payments.revenue)}
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size='sm'>
                                                {u.payments.paid} paid
                                            </Text>
                                            <Text size='xs' c='dimmed'>
                                                {u.payments.pending} pending ·{' '}
                                                {u.payments.failed} failed
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size='sm'>
                                                {u.activations.active} active
                                            </Text>
                                            <Text size='xs' c='dimmed'>
                                                {u.activations.hotspot} hs ·{' '}
                                                {u.activations.pppoe} pppoe
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size='sm'>
                                                {u.lastPaymentAt
                                                    ? dayjs(
                                                          u.lastPaymentAt,
                                                      ).fromNow()
                                                    : '—'}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size='sm'>
                                                {formatDate(u.createdAt)}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Group
                                                justify='flex-end'
                                                gap={4}
                                                wrap='nowrap'
                                            >
                                                {!u.pendingClaim ? (
                                                    <>
                                                        <Tooltip label='Edit name / location'>
                                                            <ActionIcon
                                                                variant='light'
                                                                color='gray'
                                                                aria-label={`Edit ${u.tag?.name || u.name}`}
                                                                onClick={(
                                                                    event,
                                                                ) => {
                                                                    event.stopPropagation();
                                                                    openQuickAction(
                                                                        u,
                                                                        'edit',
                                                                    );
                                                                }}
                                                            >
                                                                <MdEdit
                                                                    size={16}
                                                                />
                                                            </ActionIcon>
                                                        </Tooltip>
                                                        <Tooltip label='Flag user'>
                                                            <ActionIcon
                                                                variant='light'
                                                                color='orange'
                                                                aria-label={`Flag ${u.tag?.name || u.name}`}
                                                                onClick={(
                                                                    event,
                                                                ) => {
                                                                    event.stopPropagation();
                                                                    openQuickAction(
                                                                        u,
                                                                        'flag',
                                                                    );
                                                                }}
                                                            >
                                                                <MdFlag
                                                                    size={16}
                                                                />
                                                            </ActionIcon>
                                                        </Tooltip>
                                                        {u.banned ? (
                                                            <Tooltip label='Unban user'>
                                                                <ActionIcon
                                                                    variant='light'
                                                                    color='green'
                                                                    aria-label={`Unban ${u.tag?.name || u.name}`}
                                                                    disabled={
                                                                        quickBusy
                                                                    }
                                                                    onClick={(
                                                                        event,
                                                                    ) => {
                                                                        event.stopPropagation();
                                                                        void submitQuickUnban(
                                                                            u,
                                                                        );
                                                                    }}
                                                                >
                                                                    <MdCheckCircle
                                                                        size={
                                                                            16
                                                                        }
                                                                    />
                                                                </ActionIcon>
                                                            </Tooltip>
                                                        ) : (
                                                            <Tooltip label='Ban user'>
                                                                <ActionIcon
                                                                    variant='light'
                                                                    color='red'
                                                                    aria-label={`Ban ${u.tag?.name || u.name}`}
                                                                    onClick={(
                                                                        event,
                                                                    ) => {
                                                                        event.stopPropagation();
                                                                        openQuickAction(
                                                                            u,
                                                                            'ban',
                                                                        );
                                                                    }}
                                                                >
                                                                    <MdBlock
                                                                        size={
                                                                            16
                                                                        }
                                                                    />
                                                                </ActionIcon>
                                                            </Tooltip>
                                                        )}
                                                    </>
                                                ) : null}
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </PageTableScrollContainer>
                    <TablePagination
                        page={page}
                        perPage={perPage}
                        total={data.total}
                        onChange={setPage}
                        loading={loading}
                    />
                </>
            )}

            <UserDetailsDrawer
                userId={detailsId}
                onClose={() => setDetailsId(null)}
            />

            <Modal
                opened={provisionOpened}
                onClose={() => setProvisionOpened(false)}
                title='Provision PPPoE credentials'
                centered
            >
                {provisioned ? (
                    <Stack gap='md'>
                        <Text size='sm' c='dimmed'>
                            {provisioned.linked
                                ? `The account is linked to ${provisioned.phoneNumber}.`
                                : `Give these details to ${provisioned.phoneNumber}. The claim code links the credentials during registration.`}
                        </Text>
                        <Text size='sm'>
                            <Text span c='dimmed'>
                                Network:{' '}
                            </Text>
                            {provisioned.nasName ?? '—'}
                        </Text>
                        <CredentialField
                            label='PPPoE username'
                            value={provisioned.username}
                        />
                        <CredentialField
                            label='PPPoE password'
                            value={provisioned.password}
                        />
                        {provisioned.claimCode ? (
                            <CredentialField
                                label='One-time claim code'
                                value={provisioned.claimCode}
                            />
                        ) : null}
                        <Group justify='flex-end' mt='sm'>
                            <Button variant='default' onClick={openProvision}>
                                Provision another
                            </Button>
                            <Button onClick={() => setProvisionOpened(false)}>
                                Done
                            </Button>
                        </Group>
                    </Stack>
                ) : (
                    <form onSubmit={submitProvision}>
                        <Stack gap='md'>
                            <Text size='sm' c='dimmed'>
                                Credentials are created immediately. If the
                                phone is not registered yet, a one-time claim
                                code is generated for the customer.
                            </Text>
                            <PhoneNumberInput
                                label='Customer phone number'
                                value={provisionPhone}
                                onChange={(value) =>
                                    setProvisionPhone(value ?? '')
                                }
                                required
                            />
                            <Select
                                label='NAS device (PPPoE instance)'
                                description="The user's first login binds them to this network; the portal shows this network's packages."
                                placeholder='Select a NAS device'
                                data={nasOptions}
                                value={provisionNas}
                                onChange={setProvisionNas}
                                searchable
                                clearable={false}
                                nothingFoundMessage='No NAS devices — create one first'
                                required
                            />
                            <TextInput
                                label='Account label'
                                description='Optional line or location name'
                                placeholder='Home router'
                                value={provisionLabel}
                                onChange={(event) =>
                                    setProvisionLabel(event.currentTarget.value)
                                }
                                maxLength={80}
                            />
                            {provisionError ? (
                                <Text size='sm' c='red'>
                                    {provisionError}
                                </Text>
                            ) : null}
                            <Group justify='flex-end' mt='sm'>
                                <Button
                                    variant='default'
                                    onClick={() => setProvisionOpened(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type='submit'
                                    loading={provisioning}
                                    disabled={!provisionPhone || !provisionNas}
                                >
                                    Provision credentials
                                </Button>
                            </Group>
                        </Stack>
                    </form>
                )}
            </Modal>

            <Modal
                opened={detailsAccountId !== null}
                onClose={() => setDetailsAccountId(null)}
                title='Provisioned PPPoE account'
                centered
            >
                {accountDetailsLoading ? (
                    <Center py='xl'>
                        <Loader />
                    </Center>
                ) : accountDetails ? (
                    <Stack gap='md'>
                        <Group gap='xs'>
                            <Badge
                                color={
                                    accountDetails.status === 'active'
                                        ? 'green'
                                        : accountDetails.status === 'suspended'
                                          ? 'orange'
                                          : 'red'
                                }
                                variant='light'
                                size='sm'
                            >
                                {accountDetails.status}
                            </Badge>
                            {accountDetails.awaitingClaim ? (
                                <Badge color='violet' variant='light' size='sm'>
                                    Awaiting claim
                                </Badge>
                            ) : null}
                        </Group>
                        {accountDetails.customer ? (
                            <Text size='sm' c='dimmed'>
                                Linked to customer{' '}
                                {accountDetails.customer.name} (
                                {accountDetails.phoneNumber}).
                            </Text>
                        ) : (
                            <Text size='sm' c='dimmed'>
                                Not claimed yet. The customer registers with{' '}
                                {accountDetails.phoneNumber} and the one-time
                                claim code to link these credentials. Their
                                first PPPoE session bonds the account to the
                                network it dials through.
                            </Text>
                        )}
                        <CredentialField
                            label='PPPoE username'
                            value={accountDetails.username}
                        />
                        <Select
                            label='NAS device (PPPoE instance)'
                            description='Moving the account cuts its live sessions; the customer re-dials through the new network.'
                            placeholder='Select a NAS device'
                            data={nasOptions}
                            value={migrateNas}
                            onChange={setMigrateNas}
                            searchable
                            nothingFoundMessage='No NAS devices — create one first'
                        />
                        <Group justify='flex-end'>
                            <Button
                                size='xs'
                                variant='light'
                                color='orange'
                                loading={migrating}
                                disabled={
                                    !migrateNas ||
                                    migrateNas === accountDetails.nasDeviceId
                                }
                                onClick={submitMigrate}
                            >
                                Migrate to selected network
                            </Button>
                        </Group>
                        {accountDetails.password ? (
                            <CredentialField
                                label='PPPoE password'
                                value={accountDetails.password}
                            />
                        ) : null}
                        {regenerated?.claimCode ? (
                            <CredentialField
                                label='One-time claim code'
                                value={regenerated.claimCode}
                            />
                        ) : null}
                        <Text size='xs' c='dimmed'>
                            Provisioned {formatDate(accountDetails.createdAt)}
                            {accountDetails.lastUsedAt
                                ? ` · last used ${dayjs(accountDetails.lastUsedAt).fromNow()}`
                                : ' · never used'}
                        </Text>
                        <Group justify='flex-end' mt='sm'>
                            {accountDetails.awaitingClaim ? (
                                <Button
                                    variant='light'
                                    onClick={regenerateClaim}
                                    loading={regenerating}
                                >
                                    Regenerate credentials
                                </Button>
                            ) : null}
                            <Button onClick={() => setDetailsAccountId(null)}>
                                Close
                            </Button>
                        </Group>
                    </Stack>
                ) : (
                    <Center py='xl'>
                        <Loader />
                    </Center>
                )}
            </Modal>

            <Modal
                opened={quickModal === 'edit'}
                onClose={closeQuickAction}
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
                    <Button
                        onClick={() => void submitQuickTag()}
                        loading={quickBusy}
                    >
                        Save tag
                    </Button>
                </Stack>
            </Modal>

            <Modal
                opened={quickModal === 'flag'}
                onClose={closeQuickAction}
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
                        onClick={() => void submitQuickFlag()}
                        disabled={!flagReason.trim()}
                        loading={quickBusy}
                    >
                        Add flag
                    </Button>
                </Stack>
            </Modal>

            <Modal
                opened={quickModal === 'ban'}
                onClose={closeQuickAction}
                title='Ban user'
                centered
            >
                <Stack>
                    <Text size='sm'>
                        Ban{' '}
                        <Text span fw={600}>
                            {quickUser?.tag?.name || quickUser?.name}
                        </Text>
                        ?
                    </Text>
                    <Text size='sm' c='dimmed'>
                        Banned users cannot log in to the portals until
                        unbanned.
                    </Text>
                    <Textarea
                        label='Reason (optional)'
                        value={banReason}
                        onChange={(e) => setBanReason(e.currentTarget.value)}
                        rows={2}
                    />
                    <Button
                        color='red'
                        onClick={() => void submitQuickBan()}
                        loading={quickBusy}
                    >
                        Ban user
                    </Button>
                </Stack>
            </Modal>
        </PageLayout>
    );
}
