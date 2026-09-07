import {
    ActionIcon,
    Badge,
    Button,
    Center,
    Group,
    Loader,
    Modal,
    NumberInput,
    Stack,
    Switch,
    Table,
    Text,
    TextInput,
    Title,
    Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MdDelete, MdEdit, MdRefresh, MdSearch } from 'react-icons/md';

import {
    disconnectSession,
    editSessionTimeout,
    getRadiusSessions,
    type SessionInfo,
} from '@/lib/api';
import {
    formatBytes,
    formatDayTime,
    formatSeconds,
    formatSpeed,
    formatTime,
} from '@/lib/format';
import { notifyResult } from '@/lib/notify';

const REFRESH_SECONDS = 15;

export default function SessionsPage() {
    const [sessions, setSessions] = useState<SessionInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [lastLoaded, setLastLoaded] = useState<Date | null>(null);

    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search, 300);

    const [confirmDisconnect, setConfirmDisconnect] = useState<SessionInfo | null>(
        null,
    );
    const [editSession, setEditSession] = useState<SessionInfo | null>(null);
    const [editMinutes, setEditMinutes] = useState<number | string>('');
    const [busy, setBusy] = useState(false);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);

    const load = useCallback(async () => {
        const res = await getRadiusSessions(200);
        setLoading(false);
        if (!res.success) {
            setError(res.message || 'Failed to load sessions');
            return;
        }
        setError(null);
        setSessions(res.data ?? []);
        setLastLoaded(new Date());
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!autoRefresh) return;
        timer.current = setInterval(() => void load(), REFRESH_SECONDS * 1000);
        return () => {
            if (timer.current) clearInterval(timer.current);
        };
    }, [autoRefresh, load]);

    const filtered = debouncedSearch.trim()
        ? sessions.filter((s) =>
              `${s.username} ${s.callingStationId ?? ''} ${s.framedIpAddress ?? ''} ${s.nasIpAddress}`
                  .toLowerCase()
                  .includes(debouncedSearch.trim().toLowerCase()),
          )
        : sessions;

    const doDisconnect = async (session: SessionInfo) => {
        setBusy(true);
        const res = await disconnectSession(session.radacctId);
        setBusy(false);
        setConfirmDisconnect(null);
        notifyResult(res, 'Session disconnected');
        if (res.success) void load();
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
        if (res.success) void load();
    };

    return (
        <Stack gap='md'>
            <Group justify='space-between'>
                <Stack gap={4}>
                    <Title order={1}>Live Sessions</Title>
                    <Text size='sm' c='dimmed'>
                        Currently connected RADIUS sessions — disconnect users
                        or adjust their remaining time.
                    </Text>
                </Stack>
                <Group>
                    {lastLoaded && (
                        <Text size='xs' c='dimmed'>
                            Updated {formatTime(lastLoaded, true)}
                        </Text>
                    )}
                    <Button
                        size='xs'
                        variant='light'
                        leftSection={<MdRefresh size={14} />}
                        onClick={() => void load()}
                    >
                        Refresh
                    </Button>
                    <Switch
                        label={`Auto (${REFRESH_SECONDS}s)`}
                        checked={autoRefresh}
                        onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
                    />
                </Group>
            </Group>

            <Group wrap='wrap'>
                <TextInput
                    placeholder='Search username, MAC or IP'
                    leftSection={<MdSearch />}
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                    style={{ flex: 1, minWidth: 220 }}
                />
                <Badge variant='light' size='lg'>
                    {filtered.length} live
                </Badge>
            </Group>

            {loading ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : error ? (
                <Text c='red'>{error}</Text>
            ) : filtered.length === 0 ? (
                <Text c='dimmed' py='xl' ta='center'>
                    No live sessions.
                </Text>
            ) : (
                <Table.ScrollContainer minWidth={1000}>
                    <Table striped highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>User</Table.Th>
                                <Table.Th>Client</Table.Th>
                                <Table.Th>NAS</Table.Th>
                                <Table.Th>Started</Table.Th>
                                <Table.Th>Duration</Table.Th>
                                <Table.Th>Data</Table.Th>
                                <Table.Th>Avg speed</Table.Th>
                                <Table.Th ta='right'>Actions</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {filtered.map((s) => (
                                <Table.Tr key={s.radacctId}>
                                    <Table.Td>
                                        <Text size='sm' fw={500}>
                                            {s.username || '—'}
                                        </Text>
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
                                    <Table.Td>
                                        <Text size='sm'>{s.nasIpAddress}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size='sm'>
                                            {s.startedAt
                                                ? formatDayTime(s.startedAt)
                                                : '—'}
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
                                        <Group justify='flex-end' gap={4}>
                                            <Tooltip label='Edit remaining time'>
                                                <ActionIcon
                                                    variant='light'
                                                    aria-label='Edit session'
                                                    onClick={() => {
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
                                                    onClick={() =>
                                                        setConfirmDisconnect(s)
                                                    }
                                                >
                                                    <MdDelete size={16} />
                                                </ActionIcon>
                                            </Tooltip>
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
            )}

            <Modal
                opened={confirmDisconnect !== null}
                onClose={() => setConfirmDisconnect(null)}
                title='Disconnect session'
                centered
            >
                <Stack>
                    <Text size='sm'>
                        Disconnect {confirmDisconnect?.username || 'this user'} (
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
                        disabled={typeof editMinutes !== 'number' || editMinutes < 1}
                        loading={busy}
                    >
                        Apply
                    </Button>
                </Stack>
            </Modal>
        </Stack>
    );
}
