import {
    ActionIcon,
    Badge,
    Button,
    Center,
    Group,
    Loader,
    Stack,
    Table,
    Tabs,
    Text,
    Title,
} from '@mantine/core'
import { MdAdd, MdEdit } from 'react-icons/md'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getAdminPackages, type PackageRow, type PackageType } from '@/lib/api'
import { PackageDetailsDrawer } from '@/components/Packages/PackageDetailsDrawer'

export default function PackagesPage() {
    const navigate = useNavigate()
    const [activeTab, setActiveTab] = useState<PackageType>('hotspot')
    const [packages, setPackages] = useState<PackageRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [detailsId, setDetailsId] = useState<string | null>(null)

    const load = useCallback(async (type: PackageType) => {
        setLoading(true)
        setError(null)
        const result = await getAdminPackages(type)
        setLoading(false)
        if (!result.success) {
            setError(result.message || 'Failed to load packages')
            return
        }
        setPackages(result.data ?? [])
    }, [])

    useEffect(() => {
        load(activeTab)
    }, [activeTab, load])

    return (
        <Stack gap='md'>
            <Group justify='space-between'>
                <Title order={1}>Packages</Title>
                <Button
                    leftSection={<MdAdd />}
                    onClick={() => navigate(`/packages/add?type=${activeTab}`)}
                >
                    Add Package
                </Button>
            </Group>

            <Tabs value={activeTab} onChange={(v) => setActiveTab((v as PackageType) ?? 'hotspot')}>
                <Tabs.List>
                    <Tabs.Tab value='hotspot'>Hotspot</Tabs.Tab>
                    <Tabs.Tab value='pppoe'>PPPoE</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value={activeTab} pt='md'>
                    {loading ? (
                        <Center py='xl'>
                            <Loader />
                        </Center>
                    ) : error ? (
                        <Text c='red'>{error}</Text>
                    ) : packages.length === 0 ? (
                        <Text c='dimmed' py='xl' ta='center'>
                            No {activeTab} packages yet.
                        </Text>
                    ) : (
                        <Table.ScrollContainer minWidth={900}>
                            <Table striped highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Title</Table.Th>
                                        <Table.Th>Category</Table.Th>
                                        <Table.Th>Price</Table.Th>
                                        <Table.Th>Session</Table.Th>
                                        <Table.Th>Devices</Table.Th>
                                        <Table.Th>Rate Up/Down (Kbps)</Table.Th>
                                        <Table.Th>Quota Up/Down (KB)</Table.Th>
                                        <Table.Th>Expiry</Table.Th>
                                        <Table.Th>Status</Table.Th>
                                        <Table.Th ta='right'>Actions</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {packages.map((pkg) => (
                                        <Table.Tr
                                            key={pkg.id}
                                            onClick={() => setDetailsId(pkg.id)}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <Table.Td fw={500}>{pkg.title}</Table.Td>
                                            <Table.Td>{pkg.category}</Table.Td>
                                            <Table.Td>{Number(pkg.price).toLocaleString()}</Table.Td>
                                            <Table.Td>
                                                {pkg.noExpiry ? '—' : `${pkg.sessionLength} min`}
                                            </Table.Td>
                                            <Table.Td>{pkg.maxDevices}</Table.Td>
                                            <Table.Td>
                                                {pkg.uploadRate} / {pkg.downloadRate}
                                            </Table.Td>
                                            <Table.Td>
                                                {pkg.uploadQuota.toLocaleString()} /{' '}
                                                {pkg.downloadQuota.toLocaleString()}
                                            </Table.Td>
                                            <Table.Td>{pkg.noExpiry ? 'No expiry' : 'Expires'}</Table.Td>
                                            <Table.Td>
                                                <Badge
                                                    color={pkg.isActive ? 'green' : 'gray'}
                                                    variant='light'
                                                >
                                                    {pkg.isActive ? 'Active' : 'Inactive'}
                                                </Badge>
                                            </Table.Td>
                                            <Table.Td>
                                                <Group justify='flex-end' gap='xs'>
                                                    <ActionIcon
                                                        variant='light'
                                                        aria-label={`Edit ${pkg.title}`}
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            navigate(`/packages/${pkg.id}/edit`)
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
                </Tabs.Panel>
            </Tabs>

            <PackageDetailsDrawer
                packageId={detailsId}
                onClose={() => setDetailsId(null)}
            />
        </Stack>
    )
}
