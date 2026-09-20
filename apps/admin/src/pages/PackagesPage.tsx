import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Center,
    Group,
    Loader,
    Select,
    SimpleGrid,
    Stack,
    Table,
    Tabs,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MdAdd, MdEdit, MdSearch } from 'react-icons/md';
import { useNavigate } from 'react-router-dom';

import { PackageDetailsDrawer } from '@/components/Packages/PackageDetailsDrawer';
import { getAdminPackages, type PackageRow, type PackageType } from '@/lib/api';
import { useAutoRefresh } from '@/lib/autoRefresh';
import { warnBackgroundFailure } from '@/lib/clientError';
import { formatMoney } from '@/lib/format';

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

export default function PackagesPage() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<PackageType>('hotspot');
    const [packages, setPackages] = useState<PackageRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailsId, setDetailsId] = useState<string | null>(null);

    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search, 300);
    const [status, setStatus] = useState<string | null>(null);

    const load = useCallback(async (type: PackageType, silent = false) => {
        if (!silent) {
            setLoading(true);
            setError(null);
        }
        const result = await getAdminPackages(type);
        if (!silent) setLoading(false);
        if (!result.success) {
            if (silent) warnBackgroundFailure('refresh packages', result);
            else setError(result.message || 'Failed to load packages');
            return;
        }
        setError(null);
        setPackages(result.data ?? []);
    }, []);

    useEffect(() => {
        load(activeTab);
    }, [activeTab, load]);

    useAutoRefresh(() => void load(activeTab, true));

    const filtered = useMemo(() => {
        const q = debouncedSearch.trim().toLowerCase();
        return packages.filter((pkg) => {
            if (status === 'active' && !pkg.isActive) return false;
            if (status === 'inactive' && pkg.isActive) return false;
            if (!q) return true;
            return [pkg.title, pkg.category, pkg.description, pkg.note]
                .filter(Boolean)
                .some((field) => String(field).toLowerCase().includes(q));
        });
    }, [packages, debouncedSearch, status]);

    const summary = useMemo(() => {
        const active = filtered.filter((p) => p.isActive).length;
        const prices = filtered.map((p) => Number(p.price));
        const avgPrice =
            prices.length > 0
                ? prices.reduce((sum, p) => sum + p, 0) / prices.length
                : 0;
        return {
            total: filtered.length,
            active,
            inactive: filtered.length - active,
            avgPrice,
        };
    }, [filtered]);

    return (
        <Stack gap='md'>
            <Group justify='space-between'>
                <Stack gap={4}>
                    <Title order={3}>Packages</Title>
                    <Text size='sm' c='dimmed'>
                        Internet plans sold through your hotspot and PPPoE NAS
                        devices.
                    </Text>
                </Stack>
                <Button
                    leftSection={<MdAdd />}
                    onClick={() => navigate(`/packages/add?type=${activeTab}`)}
                >
                    Add Package
                </Button>
            </Group>

            <Tabs
                value={activeTab}
                onChange={(v) => setActiveTab((v as PackageType) ?? 'hotspot')}
            >
                <Tabs.List>
                    <Tabs.Tab value='hotspot'>Hotspot</Tabs.Tab>
                    <Tabs.Tab value='pppoe'>PPPoE</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value={activeTab} pt='md'>
                    <Stack gap='md'>
                        {!loading && !error && (
                            <SimpleGrid cols={{ base: 2, lg: 4 }}>
                                <SummaryCard
                                    label='Packages (filtered)'
                                    value={String(summary.total)}
                                />
                                <SummaryCard
                                    label='Active'
                                    value={String(summary.active)}
                                />
                                <SummaryCard
                                    label='Inactive'
                                    value={String(summary.inactive)}
                                />
                                <SummaryCard
                                    label='Avg Price'
                                    value={formatMoney(summary.avgPrice)}
                                />
                            </SimpleGrid>
                        )}

                        <Group wrap='wrap'>
                            <TextInput
                                placeholder='Search title, category or description'
                                leftSection={<MdSearch />}
                                value={search}
                                onChange={(e) =>
                                    setSearch(e.currentTarget.value)
                                }
                                style={{ flex: 1, minWidth: 220 }}
                            />
                            <Select
                                placeholder='Status'
                                clearable
                                value={status}
                                onChange={setStatus}
                                data={[
                                    { value: 'active', label: 'Active' },
                                    { value: 'inactive', label: 'Inactive' },
                                ]}
                                w={140}
                            />
                        </Group>

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
                        ) : filtered.length === 0 ? (
                            <Text c='dimmed' py='xl' ta='center'>
                                No packages match.
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
                                            <Table.Th>
                                                Rate Up/Down (Kbps)
                                            </Table.Th>
                                            <Table.Th>
                                                Quota Up/Down (KB)
                                            </Table.Th>
                                            <Table.Th>Expiry</Table.Th>
                                            <Table.Th>Status</Table.Th>
                                            <Table.Th ta='right'>
                                                Actions
                                            </Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {filtered.map((pkg) => (
                                            <Table.Tr
                                                key={pkg.id}
                                                onClick={() =>
                                                    setDetailsId(pkg.id)
                                                }
                                                style={{ cursor: 'pointer' }}
                                            >
                                                <Table.Td fw={500}>
                                                    {pkg.title}
                                                </Table.Td>
                                                <Table.Td>
                                                    {pkg.category}
                                                </Table.Td>
                                                <Table.Td>
                                                    {formatMoney(pkg.price)}
                                                </Table.Td>
                                                <Table.Td>
                                                    {pkg.noExpiry
                                                        ? '—'
                                                        : `${pkg.sessionLength} min`}
                                                </Table.Td>
                                                <Table.Td>
                                                    {pkg.maxDevices}
                                                </Table.Td>
                                                <Table.Td>
                                                    {pkg.uploadRate} /{' '}
                                                    {pkg.downloadRate}
                                                </Table.Td>
                                                <Table.Td>
                                                    {pkg.uploadQuota.toLocaleString()}{' '}
                                                    /{' '}
                                                    {pkg.downloadQuota.toLocaleString()}
                                                </Table.Td>
                                                <Table.Td>
                                                    {pkg.noExpiry
                                                        ? 'No expiry'
                                                        : 'Expires'}
                                                </Table.Td>
                                                <Table.Td>
                                                    <Badge
                                                        color={
                                                            pkg.isActive
                                                                ? 'green'
                                                                : 'gray'
                                                        }
                                                        variant='light'
                                                    >
                                                        {pkg.isActive
                                                            ? 'Active'
                                                            : 'Inactive'}
                                                    </Badge>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Group
                                                        justify='flex-end'
                                                        gap='xs'
                                                    >
                                                        <ActionIcon
                                                            variant='light'
                                                            aria-label={`Edit ${pkg.title}`}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                navigate(
                                                                    `/packages/${pkg.id}/edit`,
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
                    </Stack>
                </Tabs.Panel>
            </Tabs>

            <PackageDetailsDrawer
                packageId={detailsId}
                onClose={() => setDetailsId(null)}
            />
        </Stack>
    );
}
