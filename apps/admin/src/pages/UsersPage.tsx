import {
    Badge,
    Center,
    Checkbox,
    Group,
    Loader,
    Pagination,
    SegmentedControl,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useCallback, useEffect, useState } from 'react';
import { MdSearch } from 'react-icons/md';

import { UserDetailsDrawer } from '@/components/Users/UserDetailsDrawer';
import { getAdminUsers, type AdminUserList, type PackageType } from '@/lib/api';
import { useAutoRefresh } from '@/lib/autoRefresh';
import { dayjs } from '@/lib/dayjs';
import { formatDate, formatMoney } from '@/lib/format';
import { useAdminSettings } from '@/lib/settings';

type TypeFilter = 'all' | PackageType;

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
                if (!silent) setError(res.message || 'Failed to load users');
                return;
            }
            if (!res.data) {
                if (!silent) setError('Failed to load users');
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
                <Text c='dimmed' size='sm'>
                    {data ? `${data.total} customer(s)` : ''}
                </Text>
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
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {data.users.map((u) => (
                                    <Table.Tr
                                        key={u.id}
                                        onClick={() => setDetailsId(u.id)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <Table.Td>
                                            <Text fw={500}>{u.name}</Text>
                                            <Text size='xs' c='dimmed'>
                                                {u.phoneNumber}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Group gap={4}>
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
        </Stack>
    );
}
