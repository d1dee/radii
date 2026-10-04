import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Center,
    Group,
    Loader,
    Modal,
    NumberInput,
    Select,
    SimpleGrid,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
    Tooltip,
    UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdDelete, MdEdit, MdSearch } from 'react-icons/md';
import { useSearchParams } from 'react-router-dom';

import { PageLayout } from '@/components/Layout/PageLayout';
import { PageTableScrollContainer } from '@/components/PageTableScrollContainer';
import { SessionDetailsDrawer } from '@/components/Sessions/SessionDetailsDrawer';
import {
    SortableTableHeader,
    type SortDirection,
} from '@/components/SortableTableHeader';
import { TableFilters } from '@/components/TableFilters';
import { TablePagination } from '@/components/TablePagination';
import {
    disconnectSession,
    editSessionTimeout,
    getRadiusSessions,
    type AdminSessionRow,
    type SessionInfo,
    type SessionSortKey,
    type SessionTypeFilter,
} from '@/lib/api';
import { useAutoRefresh } from '@/lib/autoRefresh';
import { warnBackgroundFailure } from '@/lib/clientError';
import {
    formatBytes,
    formatDayTime,
    formatSeconds,
    formatSpeed,
} from '@/lib/format';
import { notifyResult } from '@/lib/notify';
import { useAdminSettings } from '@/lib/settings';

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

export default function SessionsPage() {
    // Deep links (e.g. "View sessions" from a PPPoE account card) seed the
    // search box via /sessions?q=<username>.
    const [searchParams] = useSearchParams();
    const { settings, loaded } = useAdminSettings();
    const perPage = settings.dashboard.perPage;
    const [sessions, setSessions] = useState<AdminSessionRow[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailsId, setDetailsId] = useState<string | null>(null);

    const [search, setSearch] = useState(searchParams.get('q') ?? '');
    const [debouncedSearch] = useDebouncedValue(search, 300);
    const [sessionStatus, setSessionStatus] = useState<string | null>(null);
    const [sessionType, setSessionType] = useState<SessionTypeFilter | null>(
        null,
    );
    const [sortBy, setSortBy] = useState<SessionSortKey>('startedAt');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    const [confirmDisconnect, setConfirmDisconnect] =
        useState<SessionInfo | null>(null);
    const [editSession, setEditSession] = useState<SessionInfo | null>(null);
    const [editMinutes, setEditMinutes] = useState<number | string>('');
    const [busy, setBusy] = useState(false);
    const loadRequest = useRef(0);

    const load = useCallback(
        async (pageToLoad: number, silent = false) => {
            const requestId = ++loadRequest.current;
            if (!silent) {
                setLoading(true);
                setError(null);
            }
            const res = await getRadiusSessions({
                q: debouncedSearch.trim() || undefined,
                live:
                    sessionStatus === null
                        ? undefined
                        : sessionStatus === 'live',
                sessionType: sessionType ?? undefined,
                sortBy,
                sortDirection,
                page: pageToLoad,
                perPage,
            });
            if (requestId !== loadRequest.current) return;
            if (!silent) setLoading(false);
            if (!res.success) {
                if (silent) warnBackgroundFailure('refresh sessions', res);
                else setError(res.message || 'Failed to load sessions');
                return;
            }
            setError(null);
            setSessions(res.data?.sessions ?? []);
            setTotal(res.data?.total ?? 0);
        },
        [
            debouncedSearch,
            sessionStatus,
            sessionType,
            sortBy,
            sortDirection,
            perPage,
        ],
    );

    useEffect(() => {
        setPage(1);
    }, [
        debouncedSearch,
        sessionStatus,
        sessionType,
        sortBy,
        sortDirection,
        perPage,
    ]);

    const handleSort = (key: SessionSortKey, direction: SortDirection) => {
        setSortBy(key);
        setSortDirection(direction);
    };

    useEffect(() => {
        if (!loaded) return;
        void load(page);
    }, [loaded, load, page]);

    useAutoRefresh(() => void load(page, true), loaded);

    const summary = useMemo(() => {
        const live = sessions.filter((session) => session.live).length;
        const transferred = sessions.reduce(
            (sum, session) => sum + session.totalOctets,
            0,
        );
        const averageSpeed =
            sessions.length > 0
                ? sessions.reduce(
                      (sum, session) => sum + session.avgSpeedBps,
                      0,
                  ) / sessions.length
                : 0;

        return { live, transferred, averageSpeed };
    }, [sessions]);

    const doDisconnect = async (session: SessionInfo) => {
        setBusy(true);
        const res = await disconnectSession(session.radacctId);
        setBusy(false);
        setConfirmDisconnect(null);
        notifyResult(res, 'Session disconnected');
        if (res.success) {
            setDetailsId(null);
            void load(page, true);
        }
    };

    const submitEdit = async () => {
        if (!editSession || typeof editMinutes !== 'number') return;
        setBusy(true);
        const res = await editSessionTimeout(
            editSession.radacctId,
            Math.max(1, Math.round(editMinutes * 60)),
        );
        setBusy(false);
        setEditSession(null);
        notifyResult(res, 'Session time updated');
        // A failed CoA can still reconcile a session absent from the NAS.
        void load(page, true);
    };

    return (
        <PageLayout
            label='Sessions page content'
            header={
                <Group justify='space-between'>
                    <Stack gap={4}>
                        <Title order={3}>Sessions</Title>
                        <Text size='sm' c='dimmed'>
                            RADIUS accounting history and currently connected
                            users.
                        </Text>
                    </Stack>
                </Group>
            }
        >
            {!loading && !error && (
                <SimpleGrid cols={{ base: 4 }}>
                    <SummaryCard
                        label='Sessions (filtered)'
                        value={String(total)}
                    />
                    <SummaryCard
                        label='Live on page'
                        value={String(summary.live)}
                    />
                    <SummaryCard
                        label='Data on page'
                        value={formatBytes(summary.transferred)}
                    />
                    <SummaryCard
                        label='Avg speed on page'
                        value={formatSpeed(summary.averageSpeed)}
                    />
                </SimpleGrid>
            )}

            <TableFilters
                search={
                    <TextInput
                        aria-label='Search sessions'
                        placeholder='Search username, MAC or IP'
                        leftSection={<MdSearch />}
                        value={search}
                        onChange={(e) => setSearch(e.currentTarget.value)}
                        w={{ base: '100%', sm: 'auto' }}
                        style={{ flex: '1 1 220px', minWidth: 0 }}
                    />
                }
            >
                <Select
                    aria-label='Filter sessions by status'
                    placeholder='Status'
                    clearable
                    value={sessionStatus}
                    onChange={setSessionStatus}
                    data={[
                        { value: 'live', label: 'Live' },
                        { value: 'ended', label: 'Ended' },
                    ]}
                    w={{ base: '100%', sm: 140 }}
                />
                <Select
                    aria-label='Filter sessions by type'
                    placeholder='Type'
                    clearable
                    value={sessionType}
                    onChange={(value) =>
                        setSessionType(value as SessionTypeFilter | null)
                    }
                    data={[
                        { value: 'hotspot', label: 'Hotspot' },
                        { value: 'pppoe', label: 'PPPoE' },
                    ]}
                    w={{ base: '100%', sm: 140 }}
                />
            </TableFilters>

            {loading ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : error ? (
                <Text c='red'>{error}</Text>
            ) : sessions.length === 0 ? (
                <Text c='dimmed' py='xl' ta='center'>
                    No sessions match.
                </Text>
            ) : (
                <PageTableScrollContainer
                    minWidth={1200}
                    aria-label='Sessions table'
                >
                    <Table striped highlightOnHover stickyHeader>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>#</Table.Th>
                                <SortableTableHeader
                                    label='User'
                                    width={240}
                                    sortKey='username'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                />
                                <Table.Th>Client</Table.Th>
                                <SortableTableHeader
                                    label='NAS'
                                    width={220}
                                    sortKey='nasIpAddress'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                />
                                <SortableTableHeader
                                    label='Status'
                                    width={100}
                                    sortKey='live'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                    initialDirection='desc'
                                />
                                <SortableTableHeader
                                    label='Started / Ended'
                                    sortKey='startedAt'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                    initialDirection='desc'
                                />
                                <SortableTableHeader
                                    label='Duration'
                                    sortKey='seconds'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                    initialDirection='desc'
                                />
                                <SortableTableHeader
                                    label='Data'
                                    sortKey='totalOctets'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                    initialDirection='desc'
                                />
                                <SortableTableHeader
                                    label='Avg speed'
                                    sortKey='avgSpeedBps'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                    initialDirection='desc'
                                />
                                <Table.Th ta='right'>Actions</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {sessions.map((s, i) => (
                                <Table.Tr
                                    key={s.radacctId}
                                    onClick={() => setDetailsId(s.radacctId)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <Table.Td>
                                        {(page - 1) * perPage + i + 1}
                                    </Table.Td>
                                    <Table.Td className='admin-table-identity'>
                                        <Group gap={6} wrap='nowrap'>
                                            <UnstyledButton
                                                fz='sm'
                                                fw={500}
                                                aria-label={`View session details for ${s.username || s.acctSessionId}`}
                                            >
                                                {s.username || '—'}
                                            </UnstyledButton>
                                            <Badge
                                                variant='light'
                                                size='xs'
                                                color={
                                                    s.sessionType === 'pppoe'
                                                        ? 'violet'
                                                        : 'blue'
                                                }
                                            >
                                                {s.sessionType === 'pppoe'
                                                    ? 'PPPoE'
                                                    : 'Hotspot'}
                                            </Badge>
                                        </Group>
                                        <Text size='xs' c='dimmed'>
                                            {s.acctSessionId}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size='sm'>
                                            {s.framedIpAddress ?? '—'}
                                        </Text>
                                        <Text size='xs' c='dimmed'>
                                            {s.callingStationId ?? ''}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td className='admin-table-identity'>
                                        <Text size='sm'>
                                            {s.nasName ?? '—'}
                                        </Text>
                                        <Text size='xs' c='dimmed'>
                                            {s.nasIpAddress}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Badge
                                            color={s.live ? 'green' : 'gray'}
                                            variant='light'
                                            size='sm'
                                        >
                                            {s.live ? 'Live' : 'Ended'}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size='sm'>
                                            {s.startedAt
                                                ? formatDayTime(s.startedAt)
                                                : '—'}
                                        </Text>
                                        <Text size='xs' c='dimmed'>
                                            {s.stoppedAt
                                                ? `→ ${formatDayTime(s.stoppedAt)}`
                                                : '→ live'}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Badge variant='light' size='sm'>
                                            {formatSeconds(s.seconds)}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size='sm'>
                                            {formatBytes(s.totalOctets)}
                                        </Text>
                                        <Text size='xs' c='dimmed'>
                                            ↓{formatBytes(s.outputOctets)} ↑
                                            {formatBytes(s.inputOctets)}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size='sm'>
                                            {formatSpeed(s.avgSpeedBps)}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        {s.live ? (
                                            <Group
                                                justify='flex-end'
                                                gap={4}
                                                wrap='nowrap'
                                            >
                                                <Tooltip label='Edit remaining time'>
                                                    <ActionIcon
                                                        variant='light'
                                                        aria-label='Edit session'
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setEditSession(s);
                                                            setEditMinutes(60);
                                                        }}
                                                    >
                                                        <MdEdit size={16} />
                                                    </ActionIcon>
                                                </Tooltip>
                                                <Tooltip label='Disconnect'>
                                                    <ActionIcon
                                                        variant='light'
                                                        color='red'
                                                        aria-label='Disconnect session'
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setConfirmDisconnect(
                                                                s,
                                                            );
                                                        }}
                                                    >
                                                        <MdDelete size={16} />
                                                    </ActionIcon>
                                                </Tooltip>
                                            </Group>
                                        ) : (
                                            <Text ta='right' c='dimmed'>
                                                —
                                            </Text>
                                        )}
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </PageTableScrollContainer>
            )}

            <TablePagination
                page={page}
                perPage={perPage}
                total={total}
                onChange={setPage}
                loading={loading}
            />

            <SessionDetailsDrawer
                sessionId={detailsId}
                onClose={() => setDetailsId(null)}
                onDisconnect={setConfirmDisconnect}
            />

            <Modal
                opened={confirmDisconnect !== null}
                onClose={() => setConfirmDisconnect(null)}
                title='Disconnect session'
                centered
            >
                <Stack>
                    <Text size='sm'>
                        Disconnect {confirmDisconnect?.username || 'this user'}{' '}
                        (
                        {confirmDisconnect?.framedIpAddress ??
                            confirmDisconnect?.callingStationId ??
                            confirmDisconnect?.acctSessionId}
                        )? A Disconnect-Request is sent to the NAS and the
                        accounting record is closed. The package stays active.
                    </Text>
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            onClick={() => setConfirmDisconnect(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            color='red'
                            loading={busy}
                            onClick={() =>
                                confirmDisconnect &&
                                void doDisconnect(confirmDisconnect)
                            }
                        >
                            Disconnect
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal
                opened={editSession !== null}
                onClose={() => setEditSession(null)}
                title='Edit session remaining time'
                centered
            >
                <Stack>
                    <Text size='sm' c='dimmed'>
                        Session {editSession?.username} has been up for{' '}
                        {editSession ? formatSeconds(editSession.seconds) : ''}.
                        Set the new remaining time — the NAS enforces it via CoA
                        Session-Timeout.
                    </Text>
                    <NumberInput
                        label='Remaining time (minutes)'
                        min={1}
                        value={editMinutes}
                        onChange={setEditMinutes}
                    />
                    <Button
                        onClick={() => void submitEdit()}
                        disabled={
                            typeof editMinutes !== 'number' || editMinutes < 1
                        }
                        loading={busy}
                    >
                        Apply
                    </Button>
                </Stack>
            </Modal>
        </PageLayout>
    );
}
