import {
    ActionIcon,
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
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDebouncedValue } from '@mantine/hooks';
import { generateSetupScriptSchema } from '@shared/index';
import { zod4Resolver } from 'mantine-form-zod-resolver';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MdAdd, MdEdit, MdSearch, MdTerminal } from 'react-icons/md';
import { useNavigate } from 'react-router-dom';

import { NasDetailsDrawer } from '@/components/NasDevices/NasDetailsDrawer';
import {
    generateNasSetupScript,
    getNasDevices,
    getNasSetupScript,
    type GenerateSetupScriptInput,
    type NasDeviceRow,
    type NasDeviceStatus,
    type NasSetupScriptRow,
} from '@/lib/api';
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
    const [devices, setDevices] = useState<NasDeviceRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailsId, setDetailsId] = useState<string | null>(null);

    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search, 300);
    const [status, setStatus] = useState<string | null>(null);

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
            pppoeInterface: 'ether1',
            pppoeNetwork: '10.101.0.0/16',
        },
        validate: zod4Resolver(generateSetupScriptSchema),
    });

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const result = await getNasDevices();
        setLoading(false);
        if (!result.success) {
            setError(result.message || 'Failed to load NAS devices');
            return;
        }
        setDevices(result.data ?? []);
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const filtered = useMemo(() => {
        const q = debouncedSearch.trim().toLowerCase();
        return devices.filter((device) => {
            if (status && device.status !== status) return false;
            if (!q) return true;
            return [
                device.name,
                device.ipAddress,
                device.macAddress,
                device.model,
                device.serialNumber,
                device.location,
            ]
                .filter(Boolean)
                .some((field) => String(field).toLowerCase().includes(q));
        });
    }, [devices, debouncedSearch, status]);

    const summary = useMemo(() => {
        const count = (s: NasDeviceStatus) =>
            filtered.filter((d) => d.status === s).length;
        return {
            total: filtered.length,
            active: count('active'),
            inactive: count('inactive'),
            maintenance: count('maintenance'),
            offline: count('offline'),
        };
    }, [filtered]);

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
            pppoeInterface: row?.pppoeInterface ?? 'ether1',
            pppoeNetwork: row?.pppoeNetwork ?? '10.101.0.0/16',
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

    const handleCopyScript = async () => {
        if (!scriptRow) return;
        try {
            await navigator.clipboard.writeText(scriptRow.script);
            notifications.show({
                title: 'Success',
                message: 'Script copied to clipboard',
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

    return (
        <Stack gap='md'>
            <Group justify='space-between'>
                <Title order={1}>NAS Devices</Title>
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
                    <SummaryCard label='Active' value={String(summary.active)} />
                    <SummaryCard
                        label='Maintenance'
                        value={String(summary.maintenance)}
                    />
                    <SummaryCard label='Offline' value={String(summary.offline)} />
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
            </Group>

            {loading ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : error ? (
                <Text c='red'>{error}</Text>
            ) : devices.length === 0 ? (
                <Text c='dimmed' py='xl' ta='center'>
                    No NAS devices yet. Add one to get started.
                </Text>
            ) : filtered.length === 0 ? (
                <Text c='dimmed' py='xl' ta='center'>
                    No devices match.
                </Text>
            ) : (
                <Table.ScrollContainer minWidth={900}>
                    <Table striped highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Name</Table.Th>
                                <Table.Th>IP Address</Table.Th>
                                <Table.Th>OS</Table.Th>
                                <Table.Th>Model</Table.Th>
                                <Table.Th>Serial Number</Table.Th>
                                <Table.Th>Firmware</Table.Th>
                                <Table.Th>Location</Table.Th>
                                <Table.Th>Status</Table.Th>
                                <Table.Th ta='right'>Actions</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {filtered.map((device) => (
                                <Table.Tr
                                    key={device.id}
                                    onClick={() => setDetailsId(device.id)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <Table.Td fw={500}>{device.name}</Table.Td>
                                    <Table.Td>{device.ipAddress}</Table.Td>
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
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
            )}

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
                                <Button
                                    variant='default'
                                    size='xs'
                                    onClick={handleCopyScript}
                                >
                                    Copy script
                                </Button>
                                <Button size='xs' onClick={handleRegenerate}>
                                    Regenerate
                                </Button>
                            </Group>
                        </Group>
                        {scriptError && <Text c='red'>{scriptError}</Text>}
                        <Text size='xs' c='dimmed'>
                            Paste this command into the MikroTik terminal
                            (System → Terminal). It downloads and runs the setup
                            script automatically.
                        </Text>
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
        </Stack>
    );
}
