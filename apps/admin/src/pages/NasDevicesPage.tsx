import {
    ActionIcon,
    Alert,
    Badge,
    Box,
    Button,
    Card,
    Center,
    Code,
    Group,
    Loader,
    Modal,
    Select,
    SimpleGrid,
    Stack,
    Switch,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { useDebouncedValue } from '@mantine/hooks';
import { generateSetupScriptSchema } from '@shared/index';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdAdd, MdDelete, MdEdit, MdSearch, MdTerminal } from 'react-icons/md';
import { useNavigate } from 'react-router-dom';

import { NasDetailsDrawer } from '@/components/NasDevices/NasDetailsDrawer';
import {
    SortableTableHeader,
    type SortDirection,
} from '@/components/SortableTableHeader';
import { TablePagination } from '@/components/TablePagination';
import {
    generateNasSetupScript,
    deleteNasDevice,
    getNasDevices,
    getNasSetupScript,
    type GenerateSetupScriptInput,
    type NasDeviceRow,
    type NasDeviceSortKey,
    type NasDeviceStatus,
    type NasSetupScriptRow,
} from '@/lib/api';
import { useAutoRefresh } from '@/lib/autoRefresh';
import { warnBackgroundFailure } from '@/lib/clientError';
import { formatDayTime } from '@/lib/format';
import { notifyResult } from '@/lib/notify';
import { useAdminSettings } from '@/lib/settings';
import {
    nasDeviceOsLabel,
    nasDeviceStatusColors,
    nasDeviceStatusOptions,
} from '@/lib/nas';
import { notifications } from '@mantine/notifications';

const setupScriptStatusColors: Record<NasSetupScriptRow['status'], string> = {
    pending: 'yellow',
    applied: 'green',
    failed: 'red',
};

const DEVICE_MODE_COMMAND = '/system/device-mode/update mode=advanced';

function SummaryCard({
    label,
    value,
    sub,
}: {
    label: string;
    value: string;
    sub?: string;
}) {
    return (
        <Card withBorder padding='md' radius='md'>
            <Text size='xs' c='dimmed'>
                {label}
            </Text>
            <Text size='xl' fw={700} mt={2}>
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

export default function NasDevicesPage() {
    const navigate = useNavigate();
    const { settings, loaded } = useAdminSettings();
    const perPage = settings.dashboard.perPage;
    const [devices, setDevices] = useState<NasDeviceRow[]>([]);
    const [total, setTotal] = useState(0);
    const [onlineTotal, setOnlineTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailsId, setDetailsId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<NasDeviceRow | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);

    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search, 300);
    const [status, setStatus] = useState<string | null>(null);
    const [connection, setConnection] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<NasDeviceSortKey | null>(null);
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const loadRequest = useRef(0);

    const [scriptDevice, setScriptDevice] = useState<NasDeviceRow | null>(null);
    const [scriptRow, setScriptRow] = useState<NasSetupScriptRow | null>(null);
    const [scriptLoading, setScriptLoading] = useState(false);
    const [scriptBusy, setScriptBusy] = useState(false);
    const [scriptError, setScriptError] = useState<string | null>(null);

    const form = useForm<GenerateSetupScriptInput>({
        initialValues: {
            hotspotInterface: 'ether2',
            hotspotNetwork: '10.100.0.0/16',
            hotspotDnsName: '',
            brandName: '',
            pppoeInterface: 'ether3',
            pppoeNetwork: '10.101.0.0/16',
            ipLockdown: true,
        },
        validate: schemaResolver(generateSetupScriptSchema),
    });

    const load = useCallback(
        async (pageToLoad: number, silent = false) => {
            const requestId = ++loadRequest.current;
            if (!silent) {
                setLoading(true);
                setError(null);
            }
            const result = await getNasDevices({
                q: debouncedSearch.trim() || undefined,
                status: (status as NasDeviceStatus) || undefined,
                online:
                    connection === null ? undefined : connection === 'online',
                sortBy: sortBy ?? undefined,
                sortDirection: sortBy ? sortDirection : undefined,
                page: pageToLoad,
                perPage,
            });
            if (requestId !== loadRequest.current) return;
            if (!silent) setLoading(false);
            if (!result.success) {
                if (silent)
                    warnBackgroundFailure('refresh NAS devices', result);
                else setError(result.message || 'Failed to load NAS devices');
                return;
            }
            setError(null);
            setDevices(result.data?.nasDevices ?? []);
            setTotal(result.data?.total ?? 0);
            setOnlineTotal(result.data?.onlineTotal ?? 0);
        },
        [
            debouncedSearch,
            status,
            connection,
            sortBy,
            sortDirection,
            perPage,
        ],
    );

    useEffect(() => {
        setPage(1);
    }, [
        debouncedSearch,
        status,
        connection,
        sortBy,
        sortDirection,
        perPage,
    ]);

    const handleSort = (key: NasDeviceSortKey, direction: SortDirection) => {
        setSortBy(key);
        setSortDirection(direction);
    };

    useEffect(() => {
        if (!loaded) return;
        void load(page);
    }, [loaded, load, page]);

    useAutoRefresh(() => void load(page, true), loaded);

    const summary = useMemo(() => {
        const count = (s: NasDeviceStatus) =>
            devices.filter((d) => d.status === s).length;
        return {
            total,
            active: count('active'),
            inactive: count('inactive'),
            maintenance: count('maintenance'),
            offline: count('offline'),
        };
    }, [devices, total]);

    const prefillForm = (
        row: NasSetupScriptRow | null,
        device: NasDeviceRow,
    ) => {
        form.reset();
        form.setValues({
            hotspotInterface: row?.hotspotInterface ?? 'ether2',
            hotspotNetwork: row?.hotspotNetwork ?? '10.100.0.0/16',
            hotspotDnsName: row?.hotspotDnsName ?? '',
            brandName: row?.brandName ?? device.name,
            pppoeInterface: row?.pppoeInterface ?? 'ether3',
            pppoeNetwork: row?.pppoeNetwork ?? '10.101.0.0/16',
            ipLockdown: row?.ipLockdown ?? true,
        });
    };

    const openScriptModal = async (device: NasDeviceRow) => {
        setScriptDevice(device);
        setScriptRow(null);
        setScriptError(null);
        prefillForm(null, device);
        setScriptLoading(true);
        const result = await getNasSetupScript(device.id);
        setScriptLoading(false);
        if (result.success && result.data) {
            setScriptRow(result.data);
            prefillForm(result.data, device);
        }
    };

    const closeScriptModal = () => {
        setScriptDevice(null);
        setScriptRow(null);
        setScriptError(null);
    };

    const handleGenerateScript = async (values: GenerateSetupScriptInput) => {
        if (!scriptDevice) return;
        setScriptBusy(true);
        setScriptError(null);
        const result = await generateNasSetupScript(scriptDevice.id, values);
        setScriptBusy(false);
        if (!result.success) {
            setScriptError(result.message);
            return;
        }
        if (!result.data) {
            setScriptError('Failed to generate setup script');
            return;
        }
        setScriptRow(result.data);
    };

    const handleRegenerate = () => {
        if (!scriptDevice) return;
        prefillForm(scriptRow, scriptDevice);
        setScriptError(null);
        setScriptRow(null);
    };

    const copyToClipboard = async (value: string, successMessage: string) => {
        try {
            await navigator.clipboard.writeText(value);
            notifications.show({
                title: 'Success',
                message: successMessage,
                color: 'green',
            });
        } catch (_) {
            notifications.show({
                title: 'Error',
                message: 'Failed to copy to clipboard',
                color: 'orange',
            });
        }
    };

    const handleCopyScript = () => {
        if (!scriptRow) return;
        void copyToClipboard(scriptRow.script, 'Setup script copied to clipboard');
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleteBusy(true);
        const result = await deleteNasDevice(deleteTarget.id);
        setDeleteBusy(false);
        notifyResult(result, 'NAS device deleted');
        if (!result.success) return;
        if (detailsId === deleteTarget.id) setDetailsId(null);
        setDeleteTarget(null);
        if (page > 1 && devices.length === 1) setPage(page - 1);
        else await load(page, true);
    };

    return (
        <Stack gap='md'>
            <Group justify='space-between'>
                <Stack gap={4}>
                    <Group gap='sm'>
                        <Title order={3}>NAS Devices</Title>
                        {!loading && !error ? (
                            <Badge
                                color={onlineTotal > 0 ? 'green' : 'gray'}
                                variant='light'
                            >
                                {onlineTotal} / {total} NAS connected
                            </Badge>
                        ) : null}
                    </Group>
                    <Text size='sm' c='dimmed'>
                        Routers that authenticate customers against RADIUS and
                        serve your packages.
                    </Text>
                </Stack>
                <Button
                    leftSection={<MdAdd />}
                    onClick={() => navigate('/nas-devices/add')}
                >
                    Add NAS Device
                </Button>
            </Group>

            {!loading && !error && devices.length > 0 && (
                <SimpleGrid cols={{ base: 2, lg: 4 }}>
                    <SummaryCard
                        label='Devices (filtered)'
                        value={String(summary.total)}
                        sub={`${summary.inactive} inactive`}
                    />
                    <SummaryCard
                        label='Active on page'
                        value={String(summary.active)}
                    />
                    <SummaryCard
                        label='Maintenance on page'
                        value={String(summary.maintenance)}
                    />
                    <SummaryCard
                        label='Offline on page'
                        value={String(summary.offline)}
                    />
                </SimpleGrid>
            )}

            <Group wrap='wrap'>
                <TextInput
                    placeholder='Search name, IP, model, serial or location'
                    leftSection={<MdSearch />}
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                    style={{ flex: 1, minWidth: 220 }}
                />
                <Select
                    placeholder='Status'
                    clearable
                    value={status}
                    onChange={setStatus}
                    data={nasDeviceStatusOptions}
                    w={160}
                />
                <Select
                    placeholder='Connection'
                    clearable
                    value={connection}
                    onChange={setConnection}
                    data={[
                        { value: 'online', label: 'Online' },
                        { value: 'offline', label: 'Offline' },
                    ]}
                    w={160}
                />
            </Group>

            {loading ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : error ? (
                <Text c='red'>{error}</Text>
            ) : devices.length === 0 ? (
                <Text c='dimmed' py='xl' ta='center'>
                    {debouncedSearch || status || connection
                        ? 'No devices match.'
                        : 'No NAS devices yet. Add one to get started.'}
                </Text>
            ) : (
                <Table.ScrollContainer minWidth={1080}>
                    <Table striped highlightOnHover stickyHeader>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>#</Table.Th>
                                <SortableTableHeader
                                    label='Name'
                                    sortKey='name'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                />
                                <SortableTableHeader
                                    label='IP Address'
                                    sortKey='ipAddress'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                />
                                <Table.Th>OS</Table.Th>
                                <SortableTableHeader
                                    label='Model'
                                    sortKey='model'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                />
                                <SortableTableHeader
                                    label='Serial Number'
                                    sortKey='serialNumber'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                />
                                <SortableTableHeader
                                    label='Firmware'
                                    sortKey='firmwareVersion'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                />
                                <SortableTableHeader
                                    label='Location'
                                    sortKey='location'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                />
                                <SortableTableHeader
                                    label='Connection'
                                    sortKey='online'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                />
                                <SortableTableHeader
                                    label='Last seen'
                                    sortKey='lastSeen'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                    initialDirection='desc'
                                />
                                <SortableTableHeader
                                    label='Status'
                                    sortKey='status'
                                    sortBy={sortBy}
                                    sortDirection={sortDirection}
                                    onSort={handleSort}
                                />
                                <Table.Th ta='right'>Actions</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {devices.map((device, i) => (
                                <Table.Tr
                                    key={device.id}
                                    onClick={() => setDetailsId(device.id)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <Table.Td>
                                        {(page - 1) * perPage + i + 1}
                                    </Table.Td>
                                    <Table.Td fw={500}>{device.name}</Table.Td>
                                    <Table.Td>
                                        <Stack gap={0}>
                                            <Text size='sm'>
                                                {device.ipAddress}
                                            </Text>
                                            {device.wgClientIp ? (
                                                <Text size='xs' c='dimmed'>
                                                    WG {device.wgClientIp}
                                                    {device.wgPublicKey
                                                        ? ` · ${device.wgPublicKey.slice(0, 8)}…`
                                                        : ''}
                                                </Text>
                                            ) : null}
                                        </Stack>
                                    </Table.Td>
                                    <Table.Td>
                                        {nasDeviceOsLabel(device.metadata?.os)}
                                    </Table.Td>
                                    <Table.Td>{device.model ?? '—'}</Table.Td>
                                    <Table.Td>
                                        {device.serialNumber ?? '—'}
                                    </Table.Td>
                                    <Table.Td>
                                        {device.firmwareVersion ?? '—'}
                                    </Table.Td>
                                    <Table.Td>
                                        {device.location ?? '—'}
                                    </Table.Td>
                                    <Table.Td>
                                        <Badge
                                            color={
                                                device.online ? 'green' : 'gray'
                                            }
                                            variant='light'
                                        >
                                            {device.online
                                                ? 'Online'
                                                : 'Offline'}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>
                                        {device.lastSeen
                                            ? formatDayTime(device.lastSeen)
                                            : 'Never connected'}
                                    </Table.Td>
                                    <Table.Td>
                                        <Badge
                                            color={
                                                nasDeviceStatusColors[
                                                    device.status
                                                ]
                                            }
                                            variant='light'
                                        >
                                            {device.status}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>
                                        <Group justify='flex-end' gap='xs'>
                                            <ActionIcon
                                                variant='light'
                                                aria-label={`Setup script for ${device.name}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openScriptModal(device);
                                                }}
                                            >
                                                <MdTerminal size={16} />
                                            </ActionIcon>
                                            <ActionIcon
                                                variant='light'
                                                aria-label={`Edit ${device.name}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigate(
                                                        `/nas-devices/${device.id}/edit`,
                                                    );
                                                }}
                                            >
                                                <MdEdit size={16} />
                                            </ActionIcon>
                                            <ActionIcon
                                                variant='light'
                                                color='red'
                                                aria-label={`Delete ${device.name}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleteTarget(device);
                                                }}
                                            >
                                                <MdDelete size={16} />
                                            </ActionIcon>
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
            )}

            <TablePagination
                page={page}
                perPage={perPage}
                total={total}
                onChange={setPage}
                loading={loading}
            />

            <Modal
                opened={!!scriptDevice}
                onClose={closeScriptModal}
                title={
                    <Text fw={600}>Setup script — {scriptDevice?.name}</Text>
                }
                size='xl'
            >
                {scriptLoading ? (
                    <Center py='xl'>
                        <Loader />
                    </Center>
                ) : scriptRow ? (
                    <Stack gap='md'>
                        <Group justify='space-between'>
                            <Group gap='xs'>
                                <Badge
                                    color={
                                        setupScriptStatusColors[
                                            scriptRow.status
                                        ]
                                    }
                                    variant='light'
                                >
                                    {scriptRow.status}
                                </Badge>
                                <Text size='sm' c='dimmed'>
                                    generated{' '}
                                    {new Date(
                                        scriptRow.generatedAt,
                                    ).toLocaleString()}
                                </Text>
                            </Group>
                            <Group gap='xs'>
                                <Button size='xs' onClick={handleRegenerate}>
                                    Regenerate
                                </Button>
                            </Group>
                        </Group>
                        {scriptError && <Text c='red'>{scriptError}</Text>}
                        <Card withBorder radius='md' padding='md'>
                            <Stack gap='sm'>
                                <Group justify='space-between' align='flex-start'>
                                    <div>
                                        <Text fw={600}>1. Enable device mode</Text>
                                        <Text size='sm' c='dimmed'>
                                            Paste this command into the router console first.
                                        </Text>
                                    </div>
                                    <Button
                                        variant='default'
                                        size='xs'
                                        onClick={() =>
                                            void copyToClipboard(
                                                DEVICE_MODE_COMMAND,
                                                'Device-mode command copied to clipboard',
                                            )
                                        }
                                    >
                                        Copy command
                                    </Button>
                                </Group>
                                <Code block>{DEVICE_MODE_COMMAND}</Code>
                                <Alert color='yellow' title='Physical confirmation required'>
                                    Within 5 minutes, briefly press the router's reset or mode
                                    button, or power it off and back on. The router will reboot.
                                    Reconnect to its console before continuing to Step 2.
                                </Alert>
                            </Stack>
                        </Card>

                        <Card withBorder radius='md' padding='md'>
                            <Stack gap='sm'>
                                <Group justify='space-between' align='flex-start'>
                                    <div>
                                        <Text fw={600}>2. Run the setup script</Text>
                                        <Text size='sm' c='dimmed'>
                                            After the router has rebooted, paste this command into
                                            the router console. It downloads and runs the setup
                                            script automatically.
                                        </Text>
                                    </div>
                                    <Button
                                        variant='default'
                                        size='xs'
                                        onClick={handleCopyScript}
                                    >
                                        Copy script
                                    </Button>
                                </Group>
                                <Box pos='relative'>
                                    <Code
                                        block
                                        style={{
                                            whiteSpace: 'pre-wrap',
                                            overflowWrap: 'anywhere',
                                            wordBreak: 'break-word',
                                            paddingInlineEnd: 44,
                                        }}
                                    >
                                        {scriptRow.script}
                                    </Code>
                                </Box>
                            </Stack>
                        </Card>
                    </Stack>
                ) : (
                    <form onSubmit={form.onSubmit(handleGenerateScript)}>
                        <Stack gap='md'>
                            {scriptError && <Text c='red'>{scriptError}</Text>}
                            <Text size='sm' c='dimmed'>
                                Configure the hotspot and PPPoE settings for
                                this device. A RouterOS script will be generated
                                that sets up RADIUS, hotspot, PPPoE, WireGuard
                                tunnel and branded login pages.
                            </Text>
                            <TextInput
                                label='Hotspot interface'
                                description='RouterOS interface name for the hotspot'
                                placeholder='ether2'
                                {...form.getInputProps('hotspotInterface')}
                            />
                            <TextInput
                                label='Hotspot network'
                                description='IPv4 CIDR for the hotspot DHCP pool'
                                placeholder='10.100.0.0/16'
                                {...form.getInputProps('hotspotNetwork')}
                            />
                            <TextInput
                                label='Hotspot DNS name'
                                description='Domain name clients resolve to the captive portal'
                                placeholder='hotspot.example.com'
                                {...form.getInputProps('hotspotDnsName')}
                            />
                            <TextInput
                                label='Brand name'
                                description='Displayed on the hotspot login page'
                                placeholder={scriptDevice?.name}
                                {...form.getInputProps('brandName')}
                            />
                            <TextInput
                                label='PPPoE interface'
                                description='RouterOS interface the PPPoE server listens on'
                                placeholder='ether1'
                                {...form.getInputProps('pppoeInterface')}
                            />
                            <TextInput
                                label='PPPoE network'
                                description='IPv4 CIDR for the PPPoE client address pool'
                                placeholder='10.101.0.0/16'
                                {...form.getInputProps('pppoeNetwork')}
                            />
                            <Switch
                                label='IP service lockdown'
                                description='Restrict SSH, Winbox, API and WebFig to the WireGuard management subnet and disable telnet, FTP, api-ssl and www-ssl'
                                {...form.getInputProps('ipLockdown', {
                                    type: 'checkbox',
                                })}
                            />
                            <Button type='submit' loading={scriptBusy}>
                                Generate setup script
                            </Button>
                        </Stack>
                    </form>
                )}
            </Modal>

            <NasDetailsDrawer
                nasDeviceId={detailsId}
                onClose={() => setDetailsId(null)}
            />

            <Modal
                opened={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                title='Delete NAS device'
                centered
                closeOnClickOutside={!deleteBusy}
                closeOnEscape={!deleteBusy}
                withCloseButton={!deleteBusy}
            >
                <Stack gap='md'>
                    <Text size='sm'>
                        Delete <Text span fw={600}>{deleteTarget?.name}</Text> permanently?
                    </Text>
                    <Text size='sm' c='dimmed'>
                        Its setup configuration will be removed. Devices linked to packages,
                        PPPoE accounts, customers, or payment history cannot be deleted.
                    </Text>
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            onClick={() => setDeleteTarget(null)}
                            disabled={deleteBusy}
                        >
                            Cancel
                        </Button>
                        <Button color='red' loading={deleteBusy} onClick={handleDelete}>
                            Delete device
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
}
