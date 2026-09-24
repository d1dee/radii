import {
    Badge,
    Card,
    Center,
    Divider,
    Drawer,
    Grid,
    Group,
    Loader,
    Stack,
    Table,
    Text,
    Title,
} from '@mantine/core';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import {
    getAdminPackage,
    getAllNasDevices,
    getPackageAnalytics,
    type PackageAnalytics,
    type PackagePaymentStatus,
    type PackageRow,
} from '@/lib/api';
import { TablePagination } from '@/components/TablePagination';
import { warnBackgroundFailure } from '@/lib/clientError';
import { formatDate } from '@/lib/format';
import { useAdminSettings } from '@/lib/settings';

const STATUS_BADGE: Record<
    PackagePaymentStatus,
    { color: string; label: string }
> = {
    paid: { color: 'green', label: 'Paid' },
    pending: { color: 'orange', label: 'Pending' },
    failed: { color: 'red', label: 'Failed' },
};

const NAS_BADGE_COLOR = [
    'red',
    'pink',
    'grape',
    'violet',
    'indigo',
    'blue',
    'cyan',
    'green',
    'lime',
    'yellow',
    'orange',
    'teal',
];

function StatCard({
    label,
    value,
    sub,
}: {
    label: string;
    value: ReactNode;
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

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
    return (
        <Stack gap={2}>
            <Text size='xs' c='dimmed'>
                {label}
            </Text>
            <Text size='sm' fw={500}>
                {value}
            </Text>
        </Stack>
    );
}

export function PackageDetailsDrawer({
    packageId,
    onClose,
}: {
    packageId: string | null;
    onClose: () => void;
}) {
    const { settings } = useAdminSettings();
    const perPage = settings.dashboard.perPage;
    const [pkg, setPkg] = useState<PackageRow | null>(null);
    const [analytics, setAnalytics] = useState<PackageAnalytics | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [paymentsPage, setPaymentsPage] = useState(1);
    const loadRequest = useRef(0);
    const [nasDeviceNames, setNasDeviceNames] = useState<
        Record<string, string>
    >({});

    useEffect(() => {
        (async () => {
            const result = await getAllNasDevices();
            if (result.success && result.data) {
                setNasDeviceNames(
                    Object.fromEntries(result.data.map((d) => [d.id, d.name])),
                );
            } else {
                warnBackgroundFailure(
                    'load package detail NAS names',
                    result,
                );
            }
        })();
    }, []);

    useEffect(() => {
        if (!packageId) return;
        setPaymentsPage(1);
    }, [packageId]);

    useEffect(() => {
        if (!packageId) return;
        const requestId = ++loadRequest.current;
        setPkg(null);
        setAnalytics(null);
        setError(null);

        (async () => {
            const [pkgRes, analyticsRes] = await Promise.all([
                getAdminPackage(packageId),
                getPackageAnalytics(packageId, {
                    page: paymentsPage,
                    perPage,
                }),
            ]);
            if (requestId !== loadRequest.current) return;
            if (!pkgRes.success) {
                setError(pkgRes.message);
                return;
            }
            if (!analyticsRes.success) {
                setError(analyticsRes.message);
                return;
            }
            if (!pkgRes.data || !analyticsRes.data) {
                setError('Failed to load package details');
                return;
            }
            setPkg(pkgRes.data);
            setAnalytics(analyticsRes.data);
        })();
    }, [packageId, paymentsPage, perPage]);

    const repeatRate =
        analytics && analytics.buyers.unique > 0
            ? Math.round(
                  (analytics.buyers.repeat / analytics.buyers.unique) * 100,
              )
            : 0;

    return (
        <Drawer
            opened={packageId !== null}
            onClose={onClose}
            position='right'
            size='xl'
            title={<Title order={4}>{pkg?.title ?? 'Package details'}</Title>}
        >
            {error ? (
                <Text c='red'>{error}</Text>
            ) : !pkg || !analytics ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : (
                <Stack gap='lg'>
                    <Group gap='xs'>
                        <Badge variant='light' color='grape'>
                            {pkg.type.toUpperCase()}
                        </Badge>
                        <Badge variant='light'>{pkg.category}</Badge>
                        <Badge
                            variant='light'
                            color={pkg.isActive ? 'green' : 'gray'}
                        >
                            {pkg.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                    </Group>

                    <Grid>
                        <Grid.Col span={6}>
                            <DetailItem
                                label='Price'
                                value={`Ksh ${Number(pkg.price).toLocaleString()}`}
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <DetailItem
                                label='Session Length'
                                value={
                                    pkg.noExpiry
                                        ? 'No expiry'
                                        : `${pkg.sessionLength} min`
                                }
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <DetailItem
                                label='Max Devices'
                                value={pkg.maxDevices}
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <DetailItem
                                label='Rate Up/Down'
                                value={`${pkg.uploadRate} / ${pkg.downloadRate} Kbps`}
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <DetailItem
                                label='Quota Up/Down'
                                value={`${pkg.uploadQuota.toLocaleString()} / ${pkg.downloadQuota.toLocaleString()} KB`}
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <DetailItem
                                label='Fair Usage'
                                value={
                                    pkg.fairUsageLimit > 0
                                        ? `${pkg.fairUsageLimit.toLocaleString()} KB / ${pkg.fairUsageWindowUnit === 'session' ? 'session' : `${pkg.fairUsageWindowValue} ${pkg.fairUsageWindowUnit}`}`
                                        : 'Disabled'
                                }
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <DetailItem
                                label='FUP Rate Up/Down'
                                value={
                                    pkg.fairUsageLimit > 0
                                        ? `${pkg.fairUsageUploadRate} / ${pkg.fairUsageDownloadRate} Kbps`
                                        : '—'
                                }
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <DetailItem
                                label='Burst Rate Up/Down'
                                value={
                                    pkg.burstTime > 0
                                        ? `${pkg.burstUploadRate} / ${pkg.burstDownloadRate} Kbps`
                                        : 'Disabled'
                                }
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <DetailItem
                                label='Burst Period'
                                value={
                                    pkg.burstTime > 0
                                        ? `${pkg.burstTime} seconds`
                                        : '—'
                                }
                            />
                        </Grid.Col>
                        <Grid.Col span={6}>
                            <DetailItem
                                label='Created'
                                value={formatDate(pkg.createdAt)}
                            />
                        </Grid.Col>
                        <Grid.Col span={12}>
                            <Stack gap={2}>
                                <Text size='xs' c='dimmed'>
                                    NAS Devices
                                </Text>

                                {pkg.nasDeviceIds.length === 0 ? (
                                    <Text
                                        span
                                        c='orange'
                                        inherit
                                        size='sm'
                                        fw={500}
                                    >
                                        Not linked to any NAS — hidden
                                    </Text>
                                ) : (
                                    <Group>
                                        {pkg.nasDeviceIds.map((id) => (
                                            <Badge
                                                color={
                                                    NAS_BADGE_COLOR[
                                                        Math.floor(
                                                            Math.random() * 10,
                                                        )
                                                    ]
                                                }
                                            >
                                                {nasDeviceNames[id] ?? id}
                                            </Badge>
                                        ))}
                                    </Group>
                                )}
                            </Stack>
                        </Grid.Col>
                        {pkg.description ? (
                            <Grid.Col span={12}>
                                <DetailItem
                                    label='Description'
                                    value={pkg.description}
                                />
                            </Grid.Col>
                        ) : null}
                        {pkg.note ? (
                            <Grid.Col span={12}>
                                <DetailItem label='Note' value={pkg.note} />
                            </Grid.Col>
                        ) : null}
                    </Grid>

                    <Divider label='Analytics' labelPosition='left' />

                    <Grid>
                        <Grid.Col span={4}>
                            <StatCard
                                label='Purchases'
                                value={analytics.payments.paid}
                                sub={`${analytics.payments.total} total attempts`}
                            />
                        </Grid.Col>
                        <Grid.Col span={4}>
                            <StatCard
                                label='Revenue'
                                value={`Ksh ${analytics.payments.revenue.toLocaleString()}`}
                                sub='from paid purchases'
                            />
                        </Grid.Col>
                        <Grid.Col span={4}>
                            <StatCard
                                label='Pending'
                                value={analytics.payments.pending}
                                sub='awaiting confirmation'
                            />
                        </Grid.Col>
                        <Grid.Col span={4}>
                            <StatCard
                                label='Failed / Cancelled'
                                value={analytics.payments.failed}
                                sub='failed payment attempts'
                            />
                        </Grid.Col>
                        <Grid.Col span={4}>
                            <StatCard
                                label='Unique Buyers'
                                value={analytics.buyers.unique}
                            />
                        </Grid.Col>
                        <Grid.Col span={4}>
                            <StatCard
                                label='Repeat Buys'
                                value={analytics.buyers.repeat}
                                sub={`${repeatRate}% repeat rate`}
                            />
                        </Grid.Col>
                        <Grid.Col span={4}>
                            <StatCard
                                label='Activations'
                                value={analytics.activations.total}
                                sub={`${analytics.activations.active} currently active`}
                            />
                        </Grid.Col>
                    </Grid>

                    <Divider label='Recent payments' labelPosition='left' />

                    {analytics.recentPayments.payments.length === 0 ? (
                        <Text c='dimmed'>No payments yet.</Text>
                    ) : (
                        <Table striped withTableBorder stickyHeader>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>#</Table.Th>
                                    <Table.Th>Phone</Table.Th>
                                    <Table.Th>Amount</Table.Th>
                                    <Table.Th>Status</Table.Th>
                                    <Table.Th>Date</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {analytics.recentPayments.payments.map((p, i) => (
                                    <Table.Tr key={p.id}>
                                        <Table.Td>
                                            {(paymentsPage - 1) * perPage + i + 1}
                                        </Table.Td>
                                        <Table.Td>{p.phoneNumber}</Table.Td>
                                        <Table.Td>
                                            Ksh{' '}
                                            {Number(p.amount).toLocaleString()}
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge
                                                size='sm'
                                                color={
                                                    STATUS_BADGE[p.status].color
                                                }
                                                variant='light'
                                            >
                                                {STATUS_BADGE[p.status].label}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td>
                                            {new Date(
                                                p.createdAt,
                                            ).toLocaleString()}
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    )}
                    <TablePagination
                        page={paymentsPage}
                        perPage={perPage}
                        total={analytics.recentPayments.total}
                        onChange={setPaymentsPage}
                    />
                </Stack>
            )}
        </Drawer>
    );
}
