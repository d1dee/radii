import {
    Badge,
    Button,
    Card,
    Center,
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
    UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    MdAdd,
    MdArchive,
    MdEdit,
    MdRestore,
    MdSearch,
} from 'react-icons/md';
import { useNavigate } from 'react-router-dom';

import { PageLayout } from '@/components/Layout/PageLayout';
import { PageTableScrollContainer } from '@/components/PageTableScrollContainer';
import { PackageDetailsDrawer } from '@/components/Packages/PackageDetailsDrawer';
import {
    SortableTableHeader,
    type SortDirection,
} from '@/components/SortableTableHeader';
import { TablePagination } from '@/components/TablePagination';
import { TableFilters } from '@/components/TableFilters';
import { TableRowActions } from '@/components/TableRowActions';
import {
    archiveAdminPackage,
    getAdminPackages,
    restoreAdminPackage,
    type PackageRow,
    type PackageSortKey,
    type PackageType,
} from '@/lib/api';
import { useAutoRefresh } from '@/lib/autoRefresh';
import { warnBackgroundFailure } from '@/lib/clientError';
import {
    formatMoney,
    formatPackagePrice,
    formatPackageQuota,
    formatPackageRate,
    formatSeconds,
} from '@/lib/format';
import { notifyResult } from '@/lib/notify';
import { useAdminSettings } from '@/lib/settings';

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
            <Text
                size='lg'
                fw={700}
                mt={2}
                style={{ overflowWrap: 'anywhere' }}
            >
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
    const { settings, loaded } = useAdminSettings();
    const perPage = settings.dashboard.perPage;
    const [typeFilter, setTypeFilter] = useState<PackageType | null>(null);
    const [packages, setPackages] = useState<PackageRow[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailsId, setDetailsId] = useState<string | null>(null);
    const [archiveTarget, setArchiveTarget] = useState<PackageRow | null>(null);
    const [actionBusyId, setActionBusyId] = useState<string | null>(null);

    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search, 300);
    const [archived, setArchived] = useState<
        'current' | 'archived' | 'all'
    >('current');
    const [sortBy, setSortBy] = useState<PackageSortKey | null>(null);
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const loadRequest = useRef(0);

    const load = useCallback(
        async (pageToLoad: number, silent = false) => {
            const requestId = ++loadRequest.current;
            if (!silent) {
                setLoading(true);
                setError(null);
            }
            const result = await getAdminPackages({
                type: typeFilter ?? undefined,
                q: debouncedSearch.trim() || undefined,
                archived,
                sortBy: sortBy ?? undefined,
                sortDirection: sortBy ? sortDirection : undefined,
                page: pageToLoad,
                perPage,
            });
            if (requestId !== loadRequest.current) return;
            if (!silent) setLoading(false);
            if (!result.success) {
                if (silent) warnBackgroundFailure('refresh packages', result);
                else setError(result.message || 'Failed to load packages');
                return;
            }
            setError(null);
            setPackages(result.data?.packages ?? []);
            setTotal(result.data?.total ?? 0);
        },
        [
            typeFilter,
            debouncedSearch,
            archived,
            sortBy,
            sortDirection,
            perPage,
        ],
    );

    useEffect(() => {
        setPage(1);
    }, [
        typeFilter,
        debouncedSearch,
        archived,
        sortBy,
        sortDirection,
        perPage,
    ]);

    const handleSort = (key: PackageSortKey, direction: SortDirection) => {
        setSortBy(key);
        setSortDirection(direction);
    };

    useEffect(() => {
        if (!loaded) return;
        void load(page);
    }, [loaded, load, page]);

    useAutoRefresh(() => void load(page, true), loaded);

    const summary = useMemo(() => {
        const archivedCount = packages.filter((p) => p.archivedAt).length;
        const prices = packages.map((p) => Number(p.price));
        const avgPrice =
            prices.length > 0
                ? prices.reduce((sum, p) => sum + p, 0) / prices.length
                : 0;
        return {
            total,
            current: packages.length - archivedCount,
            archived: archivedCount,
            avgPrice,
        };
    }, [packages, total]);

    const handleEdit = (pkg: PackageRow) => {
        navigate(`/packages/${pkg.id}/edit`);
    };

    const openArchiveModal = (pkg: PackageRow) => {
        setDetailsId(null);
        setArchiveTarget(pkg);
    };

    const handleArchive = async () => {
        if (!archiveTarget) return;
        setActionBusyId(archiveTarget.id);
        const result = await archiveAdminPackage(archiveTarget.id);
        setActionBusyId(null);
        notifyResult(result, 'Package archived');
        if (!result.success) return;
        setArchiveTarget(null);
        if (page > 1 && packages.length === 1) setPage(page - 1);
        else await load(page, true);
    };

    const handleRestore = async (pkg: PackageRow) => {
        setActionBusyId(pkg.id);
        const result = await restoreAdminPackage(pkg.id);
        setActionBusyId(null);
        notifyResult(result, 'Package restored');
        if (result.success) {
            setDetailsId(null);
            await load(page, true);
        }
    };

    return (
        <PageLayout
            label='Packages page content'
            header={
                <Group justify='space-between'>
                    <Stack gap={4}>
                        <Title order={3}>Packages</Title>
                        <Text size='sm' c='dimmed'>
                            Internet plans sold through your hotspot and PPPoE
                            NAS devices.
                        </Text>
                    </Stack>
                    <Button
                        leftSection={<MdAdd />}
                        onClick={() =>
                            navigate(
                                `/packages/add?type=${typeFilter ?? 'hotspot'}`,
                            )
                        }
                    >
                        Add Package
                    </Button>
                </Group>
            }
        >
            <Stack gap='md'>
                {!loading && !error && (
                    <SimpleGrid cols={{ base: 2, lg: 4 }}>
                        <SummaryCard
                            label='Packages (filtered)'
                            value={String(summary.total)}
                        />
                        <SummaryCard
                            label='Current on page'
                            value={String(summary.current)}
                        />
                        <SummaryCard
                            label='Archived on page'
                            value={String(summary.archived)}
                        />
                        <SummaryCard
                            label='Avg price on page'
                            value={formatMoney(summary.avgPrice)}
                        />
                    </SimpleGrid>
                )}

                <TableFilters
                    search={
                        <TextInput
                            aria-label='Search packages'
                            placeholder='Search title, category or description'
                            leftSection={<MdSearch />}
                            value={search}
                            onChange={(e) => setSearch(e.currentTarget.value)}
                            w={{ base: '100%', sm: 'auto' }}
                            style={{ flex: '1 1 220px', minWidth: 0 }}
                        />
                    }
                >
                    <Select
                        aria-label='Filter packages by type'
                        placeholder='Type'
                        clearable
                        value={typeFilter}
                        onChange={(v) => setTypeFilter(v as PackageType | null)}
                        data={[
                            { value: 'hotspot', label: 'Hotspot' },
                            { value: 'pppoe', label: 'PPPoE' },
                        ]}
                        w={{ base: '100%', sm: 140 }}
                    />
                    <Select
                        aria-label='Filter packages by archive state'
                        value={archived}
                        onChange={(value) =>
                            setArchived(
                                (value as 'current' | 'archived' | 'all') ??
                                    'current',
                            )
                        }
                        allowDeselect={false}
                        data={[
                            { value: 'current', label: 'Current' },
                            { value: 'archived', label: 'Archived' },
                            { value: 'all', label: 'All packages' },
                        ]}
                        w={{ base: '100%', sm: 150 }}
                    />
                </TableFilters>

                {loading ? (
                    <Center py='xl'>
                        <Loader />
                    </Center>
                ) : error ? (
                    <Text c='red'>{error}</Text>
                ) : packages.length === 0 ? (
                    <Text c='dimmed' py='xl' ta='center'>
                        {debouncedSearch || typeFilter || archived !== 'current'
                            ? 'No packages match.'
                            : 'No packages yet.'}
                    </Text>
                ) : (
                    <PageTableScrollContainer
                        minWidth={980}
                        aria-label='Packages table'
                    >
                        <Table striped highlightOnHover stickyHeader>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>#</Table.Th>
                                    <SortableTableHeader
                                        label='Title'
                                        width={240}
                                        sortKey='title'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                    />
                                    <Table.Th>Type</Table.Th>
                                    <SortableTableHeader
                                        label='Category'
                                        sortKey='category'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                    />
                                    <SortableTableHeader
                                        label='Price'
                                        sortKey='price'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                    />
                                    <SortableTableHeader
                                        label='Session'
                                        sortKey='sessionLength'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                    />
                                    <SortableTableHeader
                                        label='Devices'
                                        sortKey='maxDevices'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                    />
                                    <Table.Th>Rate up/down</Table.Th>
                                    <Table.Th>Quota up/down</Table.Th>
                                    <Table.Th>Expiry</Table.Th>
                                    <SortableTableHeader
                                        label='Status'
                                        width={100}
                                        sortKey='isActive'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                    />
                                    <Table.Th
                                        ta='right'
                                        className='admin-table-actions'
                                    >
                                        Actions
                                    </Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {packages.map((pkg, i) => (
                                    <Table.Tr
                                        key={pkg.id}
                                        onClick={() => setDetailsId(pkg.id)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <Table.Td>
                                            {(page - 1) * perPage + i + 1}
                                        </Table.Td>
                                        <Table.Td
                                            fw={500}
                                            className='admin-table-identity'
                                        >
                                            <UnstyledButton
                                                fz='sm'
                                                fw={500}
                                                aria-label={`View details for ${pkg.title}`}
                                            >
                                                {pkg.title}
                                            </UnstyledButton>
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge
                                                color={
                                                    pkg.type === 'hotspot'
                                                        ? 'blue'
                                                        : 'violet'
                                                }
                                                variant='light'
                                            >
                                                {pkg.type === 'hotspot'
                                                    ? 'Hotspot'
                                                    : 'PPPoE'}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td>{pkg.category}</Table.Td>
                                        <Table.Td className='admin-table-value'>
                                            {formatPackagePrice(pkg.price)}
                                        </Table.Td>
                                        <Table.Td>
                                            {formatSeconds(
                                                pkg.sessionLength * 60,
                                            )}
                                        </Table.Td>
                                        <Table.Td>{pkg.maxDevices}</Table.Td>
                                        <Table.Td>
                                            {formatPackageRate(pkg.uploadRate)}{' '}
                                            /{' '}
                                            {formatPackageRate(
                                                pkg.downloadRate,
                                            )}
                                        </Table.Td>
                                        <Table.Td>
                                            {formatPackageQuota(
                                                pkg.uploadQuota,
                                            )}{' '}
                                            /{' '}
                                            {formatPackageQuota(
                                                pkg.downloadQuota,
                                            )}
                                        </Table.Td>
                                        <Table.Td>
                                            {pkg.noExpiry
                                                ? 'Unlimited'
                                                : 'Expires'}
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge
                                                color={pkg.archivedAt ? 'gray' : 'green'}
                                                variant='light'
                                            >
                                                {pkg.archivedAt ? 'Archived' : 'Current'}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td className='admin-table-actions'>
                                            <TableRowActions
                                                gap='xs'
                                                actions={
                                                    pkg.archivedAt
                                                        ? [
                                                              {
                                                                  label: 'Restore package',
                                                                  ariaLabel: `Restore ${pkg.title}`,
                                                                  icon: <MdRestore size={16} />,
                                                                  loading:
                                                                      actionBusyId ===
                                                                      pkg.id,
                                                                  onClick: () =>
                                                                      handleRestore(
                                                                          pkg,
                                                                      ),
                                                              },
                                                          ]
                                                        : [
                                                              {
                                                                  label: 'Edit package',
                                                                  ariaLabel: `Edit ${pkg.title}`,
                                                                  icon: <MdEdit size={16} />,
                                                                  onClick: () =>
                                                                      handleEdit(pkg),
                                                              },
                                                              {
                                                                  label: 'Archive package',
                                                                  ariaLabel: `Archive ${pkg.title}`,
                                                                  icon: <MdArchive size={16} />,
                                                                  color: 'red',
                                                                  onClick: () =>
                                                                      openArchiveModal(
                                                                          pkg,
                                                                      ),
                                                              },
                                                          ]
                                                }
                                            />
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
            </Stack>

            <PackageDetailsDrawer
                packageId={detailsId}
                onClose={() => setDetailsId(null)}
                onEdit={handleEdit}
                onArchive={openArchiveModal}
                onRestore={handleRestore}
                actionBusyId={actionBusyId}
            />

            <Modal
                opened={archiveTarget !== null}
                onClose={() => setArchiveTarget(null)}
                title='Archive package'
                centered
                closeOnClickOutside={actionBusyId === null}
                closeOnEscape={actionBusyId === null}
                withCloseButton={actionBusyId === null}
            >
                <Stack gap='md'>
                    <Text size='sm'>
                        Archive{' '}
                        <Text span fw={600}>
                            {archiveTarget?.title}
                        </Text>{' '}
                        ?
                    </Text>
                    <Text size='sm' c='dimmed'>
                        It will be hidden from customers. Payment and activation
                        history will remain available, and the package can be
                        restored later.
                    </Text>
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            onClick={() => setArchiveTarget(null)}
                            disabled={actionBusyId !== null}
                        >
                            Cancel
                        </Button>
                        <Button
                            color='red'
                            loading={actionBusyId !== null}
                            onClick={handleArchive}
                        >
                            Archive package
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </PageLayout>
    );
}
