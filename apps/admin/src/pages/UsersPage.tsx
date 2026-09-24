import {
    ActionIcon,
    Badge,
    Button,
    Center,
    Checkbox,
    CopyButton,
    Group,
    Loader,
    Modal,
    Pagination,
    SegmentedControl,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { PhoneNumberInput } from '@radii/ui';
import { useCallback, useEffect, useState } from 'react';
import { MdAdd, MdCheck, MdContentCopy, MdDelete, MdSearch } from 'react-icons/md';

import { UserDetailsDrawer } from '@/components/Users/UserDetailsDrawer';
import {
    getAdminUsers,
    deleteAdminUser,
    getNasDevices,
    getPppoeAccount,
    migratePppoeAccountNas,
    provisionPppoeAccount,
    type AdminUserList,
    type AdminUserRow,
    type NasDeviceRow,
    type PackageType,
    type PppoeAccountDetail,
    type ProvisionedPppoeAccount,
} from '@/lib/api';
import { useAutoRefresh } from '@/lib/autoRefresh';
import { warnBackgroundFailure } from '@/lib/clientError';
import { dayjs } from '@/lib/dayjs';
import { formatDate, formatMoney } from '@/lib/format';
import { useAdminSettings } from '@/lib/settings';
import { notifyResult } from '@/lib/notify';

type TypeFilter = 'all' | PackageType;

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
    const [page, setPage] = useState(1);
    const [detailsId, setDetailsId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
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

    useEffect(() => {
        void (async () => {
            const res = await getNasDevices();
            if (res.success && res.data) setNasDevices(res.data);
            else warnBackgroundFailure('load user NAS options', res);
        })();
    }, []);

    const nasOptions = nasDevices.map((device) => ({
        value: device.id,
        label: device.location ? `${device.name} · ${device.location}` : device.name,
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
            if (!silent) {
                setLoading(true);
                setError(null);
            }
            const res = await getAdminUsers({
                q: debouncedSearch.trim() || undefined,
                type: typeFilter === 'all' ? undefined : typeFilter,
                flagged: flaggedOnly || undefined,
                page: pageToLoad,
                perPage,
            });
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
        [debouncedSearch, typeFilter, flaggedOnly, perPage],
    );

    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, typeFilter, flaggedOnly, perPage]);

    useEffect(() => {
        if (!loaded) return;
        void load(page);
    }, [loaded, load, page]);

    useAutoRefresh(() => void load(page, true), loaded);

    const totalPages = data ? Math.max(1, Math.ceil(data.total / perPage)) : 1;

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

    async function submitDelete() {
        if (!deleteTarget || deleteTarget.pendingClaim) return;
        setDeleteBusy(true);
        const result = await deleteAdminUser(deleteTarget.id);
        setDeleteBusy(false);
        notifyResult(result, 'User deleted');
        if (!result.success) return;
        if (detailsId === deleteTarget.id) setDetailsId(null);
        setDeleteTarget(null);
        const regularUsersOnPage =
            data?.users.filter((candidate) => !candidate.pendingClaim).length ?? 0;
        if (page > 1 && regularUsersOnPage === 1) setPage(page - 1);
        else await load(page, true);
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
        <Stack gap='md'>
            <Group justify='space-between'>
                <Stack gap={4}>
                    <Title order={3}>Users</Title>
                    <Text size='sm' c='dimmed'>
                        Customers registered through your portals, with spend
                        and activation history.
                    </Text>
                </Stack>
                <Group>
                    <Text c='dimmed' size='sm'>
                        {data ? `${data.total} customer(s)` : ''}
                    </Text>
                    <Button leftSection={<MdAdd />} onClick={openProvision}>
                        Provision PPPoE
                    </Button>
                </Group>
            </Group>

            <Group wrap='wrap'>
                <TextInput
                    placeholder='Search name, phone or email'
                    leftSection={<MdSearch />}
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                    style={{ flex: 1, minWidth: 220 }}
                />
                <SegmentedControl
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
            </Group>

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
                    <Table.ScrollContainer minWidth={900}>
                        <Table striped highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>User</Table.Th>
                                    <Table.Th>Status</Table.Th>
                                    <Table.Th>Lifetime spend</Table.Th>
                                    <Table.Th>Payments</Table.Th>
                                    <Table.Th>Activations</Table.Th>
                                    <Table.Th>Last payment</Table.Th>
                                    <Table.Th>Registered</Table.Th>
                                    <Table.Th ta='right'>Actions</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {data.users.map((u) => (
                                    <Table.Tr
                                        key={u.id}
                                        onClick={
                                            u.pendingClaim
                                                ? () => setDetailsAccountId(u.id)
                                                : () => setDetailsId(u.id)
                                        }
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <Table.Td>
                                            <Text fw={500}>
                                                {u.tag?.name || u.name}
                                            </Text>
                                            <Text size='xs' c='dimmed'>
                                                {u.phoneNumber}
                                                {u.tag?.location
                                                    ? ` · ${u.tag.location}`
                                                    : ''}
                                            </Text>
                                            {u.pendingClaim && u.pppoe ? (
                                                <Text size='xs' c='dimmed' ff='monospace'>
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
                                        <Table.Td>
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
                                            <Group justify='flex-end'>
                                                {!u.pendingClaim ? (
                                                    <ActionIcon
                                                        variant='light'
                                                        color='red'
                                                        aria-label={`Delete ${u.tag?.name || u.name}`}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setDeleteTarget(u);
                                                        }}
                                                    >
                                                        <MdDelete size={16} />
                                                    </ActionIcon>
                                                ) : null}
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                    {totalPages > 1 && (
                        <Group justify='center'>
                            <Pagination
                                value={page}
                                onChange={setPage}
                                total={totalPages}
                            />
                        </Group>
                    )}
                </>
            )}

            <UserDetailsDrawer
                userId={detailsId}
                onClose={() => setDetailsId(null)}
            />

            <Modal
                opened={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                title='Delete user'
                centered
                closeOnClickOutside={!deleteBusy}
                closeOnEscape={!deleteBusy}
                withCloseButton={!deleteBusy}
            >
                <Stack gap='md'>
                    <Text size='sm'>
                        Delete{' '}
                        <Text span fw={600}>
                            {deleteTarget?.tag?.name || deleteTarget?.name}
                        </Text>{' '}
                        permanently?
                    </Text>
                    <Text size='sm' c='dimmed'>
                        This removes the customer sign-in account. Shared customers and users
                        with payment, activation, or PPPoE history cannot be deleted; ban them
                        instead.
                    </Text>
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            onClick={() => setDeleteTarget(null)}
                            disabled={deleteBusy}
                        >
                            Cancel
                        </Button>
                        <Button color='red' loading={deleteBusy} onClick={submitDelete}>
                            Delete user
                        </Button>
                    </Group>
                </Stack>
            </Modal>

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
                            <Button
                                variant='default'
                                onClick={openProvision}
                            >
                                Provision another
                            </Button>
                            <Button
                                onClick={() => setProvisionOpened(false)}
                            >
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
                                Linked to customer {accountDetails.customer.name}{' '}
                                ({accountDetails.phoneNumber}).
                            </Text>
                        ) : (
                            <Text size='sm' c='dimmed'>
                                Not claimed yet. The customer registers with{' '}
                                {accountDetails.phoneNumber} and the one-time
                                claim code to link these credentials. Their first
                                PPPoE session bonds the account to the network it
                                dials through.
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
        </Stack>
    );
}
