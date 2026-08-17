import {
    ActionIcon,
    Badge,
    Button,
    Center,
    Group,
    Loader,
    Modal,
    ScrollArea,
    Stack,
    Table,
    Text,
    Title,
} from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { MdAdd, MdEdit, MdTerminal } from 'react-icons/md'
import { useNavigate } from 'react-router-dom'

import {
    generateNasSetupScript,
    getNasDevices,
    getNasSetupScript,
    type NasDeviceRow,
    type NasSetupScriptRow,
} from '@/lib/api'
import {
    nasDeviceOsLabel,
    nasDeviceStatusColors,
} from '@/lib/nas'

const setupScriptStatusColors: Record<NasSetupScriptRow['status'], string> = {
    pending: 'yellow',
    applied: 'green',
    failed: 'red',
}

export default function NasDevicesPage() {
    const navigate = useNavigate()
    const [devices, setDevices] = useState<NasDeviceRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [scriptDevice, setScriptDevice] = useState<NasDeviceRow | null>(null)
    const [scriptRow, setScriptRow] = useState<NasSetupScriptRow | null>(null)
    const [scriptLoading, setScriptLoading] = useState(false)
    const [scriptBusy, setScriptBusy] = useState(false)
    const [scriptError, setScriptError] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        const result = await getNasDevices()
        setLoading(false)
        if (!result.success) {
            setError(result.message || 'Failed to load NAS devices')
            return
        }
        setDevices(result.data ?? [])
    }, [])

    useEffect(() => {
        load()
    }, [load])

    const openScriptModal = async (device: NasDeviceRow) => {
        setScriptDevice(device)
        setScriptRow(null)
        setScriptError(null)
        setScriptLoading(true)
        const result = await getNasSetupScript(device.id)
        setScriptLoading(false)
        if (result.success && result.data) {
            setScriptRow(result.data)
        }
    }

    const closeScriptModal = () => {
        setScriptDevice(null)
        setScriptRow(null)
        setScriptError(null)
    }

    const handleGenerateScript = async () => {
        if (!scriptDevice) return
        setScriptBusy(true)
        setScriptError(null)
        const result = await generateNasSetupScript(scriptDevice.id)
        setScriptBusy(false)
        if (!result.success) {
            setScriptError(result.message)
            return
        }
        if (!result.data) {
            setScriptError('Failed to generate setup script')
            return
        }
        setScriptRow(result.data)
    }

    const handleCopyScript = async () => {
        if (!scriptRow) return
        await navigator.clipboard.writeText(scriptRow.script)
    }

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
                            {devices.map((device) => (
                                <Table.Tr
                                    key={device.id}
                                    onClick={() =>
                                        navigate(`/nas-devices/${device.id}/edit`)
                                    }
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
                                    <Table.Td>{device.location ?? '—'}</Table.Td>
                                    <Table.Td>
                                        <Badge
                                            color={nasDeviceStatusColors[device.status]}
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
                                                    e.stopPropagation()
                                                    openScriptModal(device)
                                                }}
                                            >
                                                <MdTerminal size={16} />
                                            </ActionIcon>
                                            <ActionIcon
                                                variant='light'
                                                aria-label={`Edit ${device.name}`}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    navigate(
                                                        `/nas-devices/${device.id}/edit`,
                                                    )
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
                    <Text fw={600}>
                        Setup script — {scriptDevice?.name}
                    </Text>
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
                                        setupScriptStatusColors[scriptRow.status]
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
                                <Button
                                    size='xs'
                                    loading={scriptBusy}
                                    onClick={handleGenerateScript}
                                >
                                    Regenerate
                                </Button>
                            </Group>
                        </Group>
                        {scriptError && <Text c='red'>{scriptError}</Text>}
                        <ScrollArea h={460} type='auto'>
                            <Text component='pre' size='xs' maw={860}>
                                {scriptRow.script}
                            </Text>
                        </ScrollArea>
                        <Text size='xs' c='dimmed'>
                            Paste this single line into the MikroTik terminal
                            (System → Terminal). It downloads and runs the setup
                            script automatically.
                        </Text>
                    </Stack>
                ) : (
                    <Stack gap='md'>
                        {scriptError && <Text c='red'>{scriptError}</Text>}
                        <Text size='sm' c='dimmed'>
                            Generates a device-specific RouterOS script that
                            configures the external radii RADIUS, hotspot with
                            RADIUS authentication, a WireGuard management
                            tunnel, API lockdown and branded hotspot pages.
                            Unique keys and secrets are generated and stored
                            with the script.
                        </Text>
                        <Button
                            loading={scriptBusy}
                            onClick={handleGenerateScript}
                        >
                            Generate setup script
                        </Button>
                    </Stack>
                )}
            </Modal>
        </Stack>
    )
}
