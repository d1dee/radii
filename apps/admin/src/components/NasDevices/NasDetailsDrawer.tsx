import {
    Badge,
    Card,
    Center,
    Code,
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

import { TablePagination } from '@/components/TablePagination';
import {
    getAllAdminPackages,
    getNasDevice,
    getNasDeviceAnalytics,
    getNasSetupScript,
    type NasDeviceAnalytics,
    type NasDeviceRow,
    type NasSetupScriptRow,
    type PackagePaymentStatus,
    type PackageRow,
} from '@/lib/api';
import {
    formatDate,
    formatPackagePrice,
    formatPaymentAmount,
} from '@/lib/format';
import { nasDeviceOsLabel, nasDeviceStatusColors } from '@/lib/nas';
import { useAdminSettings } from '@/lib/settings';

const STATUS_BADGE: Record<
    PackagePaymentStatus,
    { color: string; label: string }
> = {
    paid: { color: 'green', label: 'Paid' },
    pending: { color: 'orange', label: 'Pending' },
    failed: { color: 'red', label: 'Failed' },
};

const SCRIPT_STATUS_COLOR: Record<NasSetupScriptRow['status'], string> = {
    pending: 'yellow',
    applied: 'green',
    failed: 'red',
};

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

export function NasDetailsDrawer({
    nasDeviceId,
    onClose,
}: {
    nasDeviceId: string | null;
    onClose: () => void;
}) {
    const { settings } = useAdminSettings();
    const perPage = settings.dashboard.perPage;
    const [device, setDevice] = useState<NasDeviceRow | null>(null);
    const [analytics, setAnalytics] = useState<NasDeviceAnalytics | null>(null);
    const [linkedPackages, setLinkedPackages] = useState<PackageRow[]>([]);
    const [scriptRow, setScriptRow] = useState<NasSetupScriptRow | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [paymentsPage, setPaymentsPage] = useState(1);
    const loadRequest = useRef(0);

    useEffect(() => {
        if (nasDeviceId) setPaymentsPage(1);
    }, [nasDeviceId]);

    useEffect(() => {
        if (!nasDeviceId) return;
        const requestId = ++loadRequest.current;
        setDevice(null);
        setAnalytics(null);
        setLinkedPackages([]);
        setScriptRow(null);
        setError(null);

        (async () => {
            const [deviceRes, analyticsRes, packagesRes, scriptRes] =
                await Promise.all([
                    getNasDevice(nasDeviceId),
                    getNasDeviceAnalytics(nasDeviceId, {
                        page: paymentsPage,
                        perPage,
                    }),
                    getAllAdminPackages(),
                    getNasSetupScript(nasDeviceId),
                ]);
            if (requestId !== loadRequest.current) return;
            if (!deviceRes.success) {
                setError(deviceRes.message);
                return;
            }
            if (!analyticsRes.success) {
                setError(analyticsRes.message);
                return;
            }
            if (!deviceRes.data || !analyticsRes.data) {
                setError('Failed to load NAS device details');
                return;
            }
            setDevice(deviceRes.data);
            setAnalytics(analyticsRes.data);
            if (packagesRes.success && packagesRes.data) {
                setLinkedPackages(
                    packagesRes.data.filter((p) =>
                        p.nasDeviceIds.includes(nasDeviceId),
                    ),
                );
            }
            if (scriptRes.success && scriptRes.data) {
                setScriptRow(scriptRes.data);
            }
        })();
    }, [nasDeviceId, paymentsPage, perPage]);

    const repeatRate =
        analytics && analytics.buyers.unique > 0
            ? Math.round(
                  (analytics.buyers.repeat / analytics.buyers.unique) * 100,
              )
            : 0;

    return (
        <Drawer
            opened={nasDeviceId !== null}
            onClose={onClose}
            position='right'
            size='xl'
            styles={{
                body: { overflowWrap: 'anywhere' },
                title: { minWidth: 0, flex: 1 },
                close: { flexShrink: 0 },
            }}
            title={
                <Title component='span' order={4}>
                    {device?.name ?? 'NAS details'}
                </Title>
            }
        >
            {error ? (
                <Text c='red'>{error}</Text>
            ) : !device || !analytics ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : (
                <Stack gap='lg'>
                    <Group gap='xs'>
                        <Badge
                            variant='light'
                            color={nasDeviceStatusColors[device.status]}
                        >
                            {device.status}
                        </Badge>
                        <Badge variant='light'>
                            {nasDeviceOsLabel(device.metadata?.os)}
                        </Badge>
                    </Group>

                    <Grid>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='IP Address'
                                value={
                                    <Stack gap={0}>
                                        <Text size='sm' fw={500}>
                                            {device.ipAddress}
                                        </Text>
                                        {device.wgClientIp ? (
                                            <Text size='xs' c='dimmed'>
                                                WG {device.wgClientIp}
                                            </Text>
                                        ) : null}
                                    </Stack>
                                }
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='MAC Address'
                                value={device.macAddress ?? '—'}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Model'
                                value={device.model ?? '—'}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Serial Number'
                                value={device.serialNumber ?? '—'}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Firmware'
                                value={device.firmwareVersion ?? '—'}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Location'
                                value={device.location ?? '—'}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Created'
                                value={formatDate(device.createdAt)}
                            />
                        </Grid.Col>
                    </Grid>

                    <Divider label='Setup script' labelPosition='left' />

                    {scriptRow ? (
                        <Group gap='xs'>
                            <Badge
                                variant='light'
                                color={SCRIPT_STATUS_COLOR[scriptRow.status]}
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
                    ) : (
                        <Text size='sm' c='dimmed'>
                            Not generated yet.
                        </Text>
                    )}

                    <Divider label='WireGuard tunnel' labelPosition='left' />

                    {device.wgClientIp || device.wgPublicKey ? (
                        <Grid>
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <DetailItem
                                    label='Tunnel IP'
                                    value={device.wgClientIp ?? '—'}
                                />
                            </Grid.Col>
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <DetailItem
                                    label='Key reported'
                                    value={
                                        scriptRow?.wgKeyReportedAt
                                            ? new Date(
                                                  scriptRow.wgKeyReportedAt,
                                              ).toLocaleString()
                                            : 'Never'
                                    }
                                />
                            </Grid.Col>
                            <Grid.Col span={12}>
                                <DetailItem
                                    label='Device public key'
                                    value={
                                        device.wgPublicKey ? (
                                            <Code
                                                style={{
                                                    overflowWrap: 'anywhere',
                                                }}
                                            >
                                                {device.wgPublicKey}
                                            </Code>
                                        ) : (
                                            '—'
                                        )
                                    }
                                />
                            </Grid.Col>
                        </Grid>
                    ) : (
                        <Text size='sm' c='dimmed'>
                            No WireGuard tunnel — generate a setup script first.
                        </Text>
                    )}

                    <Divider
                        label={`Packages (${analytics.packages.active} active of ${analytics.packages.total})`}
                        labelPosition='left'
                    />

                    {linkedPackages.length === 0 ? (
                        <Text size='sm' c='orange'>
                            No packages linked — nothing is offered on this
                            device
                        </Text>
                    ) : (
                        <Group>
                            {linkedPackages.map((pkg) => (
                                <Badge
                                    key={pkg.id}
                                    maw='100%'
                                    variant='light'
                                    color={pkg.isActive ? undefined : 'gray'}
                                >
                                    {pkg.title} ·{' '}
                                    {formatPackagePrice(pkg.price)}
                                </Badge>
                            ))}
                        </Group>
                    )}

                    <Divider label='Analytics' labelPosition='left' />

                    <Grid>
                        <Grid.Col span={{ base: 12, xs: 6, sm: 4 }}>
                            <StatCard
                                label='Purchases'
                                value={analytics.payments.paid}
                                sub={`${analytics.payments.total} total attempts`}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, xs: 6, sm: 4 }}>
                            <StatCard
                                label='Revenue'
                                value={`Ksh ${analytics.payments.revenue.toLocaleString()}`}
                                sub='from paid purchases'
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, xs: 6, sm: 4 }}>
                            <StatCard
                                label='Pending'
                                value={analytics.payments.pending}
                                sub='awaiting confirmation'
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, xs: 6, sm: 4 }}>
                            <StatCard
                                label='Failed / Cancelled'
                                value={analytics.payments.failed}
                                sub='failed payment attempts'
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, xs: 6, sm: 4 }}>
                            <StatCard
                                label='Unique Buyers'
                                value={analytics.buyers.unique}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, xs: 6, sm: 4 }}>
                            <StatCard
                                label='Repeat Buys'
                                value={analytics.buyers.repeat}
                                sub={`${repeatRate}% repeat rate`}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, xs: 6, sm: 4 }}>
                            <StatCard
                                label='Activations'
                                value={analytics.activations.total}
                                sub={`${analytics.activations.active} currently active`}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, xs: 6, sm: 4 }}>
                            <StatCard
                                label='RADIUS Sessions'
                                value={analytics.sessions.total}
                                sub={`${analytics.sessions.active} currently active`}
                            />
                        </Grid.Col>
                    </Grid>

                    <Divider label='Recent payments' labelPosition='left' />

                    {analytics.recentPayments.payments.length === 0 ? (
                        <Text c='dimmed'>No payments yet.</Text>
                    ) : (
                        <Table.ScrollContainer
                            minWidth={720}
                            aria-label='NAS recent payments'
                        >
                            <Table striped stickyHeader>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>#</Table.Th>
                                        <Table.Th>Phone</Table.Th>
                                        <Table.Th>Package</Table.Th>
                                        <Table.Th>Amount</Table.Th>
                                        <Table.Th>Status</Table.Th>
                                        <Table.Th>Date</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {analytics.recentPayments.payments.map(
                                        (p, i) => (
                                            <Table.Tr key={p.id}>
                                                <Table.Td>
                                                    {(paymentsPage - 1) *
                                                        perPage +
                                                        i +
                                                        1}
                                                </Table.Td>
                                                <Table.Td>
                                                    {p.phoneNumber}
                                                </Table.Td>
                                                <Table.Td>
                                                    {p.packageTitle}
                                                </Table.Td>
                                                <Table.Td>
                                                    {formatPaymentAmount(
                                                        p.amount,
                                                    )}
                                                </Table.Td>
                                                <Table.Td>
                                                    <Badge
                                                        size='sm'
                                                        color={
                                                            STATUS_BADGE[
                                                                p.status
                                                            ].color
                                                        }
                                                        variant='light'
                                                    >
                                                        {
                                                            STATUS_BADGE[
                                                                p.status
                                                            ].label
                                                        }
                                                    </Badge>
                                                </Table.Td>
                                                <Table.Td>
                                                    {new Date(
                                                        p.createdAt,
                                                    ).toLocaleString()}
                                                </Table.Td>
                                            </Table.Tr>
                                        ),
                                    )}
                                </Table.Tbody>
                            </Table>
                        </Table.ScrollContainer>
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
