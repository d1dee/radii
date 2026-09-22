import {
    Alert,
    Button,
    Card,
    Group,
    Loader,
    Paper,
    SimpleGrid,
    Stack,
    Text,
} from '@mantine/core';
import { upperFirstCase } from '@radii/shared';
import { dayjs } from '../../lib/dayjs.ts';

import humanFormat from 'human-format';
import { useContext, useState } from 'react';
import { AiOutlineExclamationCircle } from 'react-icons/ai';
import { ModalActionsContext } from '../../App.tsx';
import { useSession } from '../../lib/auth.ts';
import { usePppoeAccounts } from '../../lib/store.ts';
import type { Package, Packages } from '../../types/index.ts';

export const dataScale = new humanFormat.Scale({
    Kbps: 1,
    Mbps: 1e3,
    Gbps: 1e6,
});

export function formatPackageRate(rate: number | null | undefined) {
    return rate == null || rate === 0
        ? 'Unlimited'
        : humanFormat(rate, { scale: dataScale });
}

export function formatPackagePrice(price: number) {
    return price === 0 ? 'Free' : `Ksh ${price.toLocaleString()}`;
}

function getPackagesByTitle(title: string, packages: Packages) {
    const h = packages.find(
        ([t, _]) => t.toLowerCase() === title.toLowerCase(),
    );
    return h ? h[1] : [];
}

export function PackagePricing({
    packages,
    error,
    loading,
    onRetry,
}: {
    packages: Packages | undefined;
    error: string | null;
    loading: boolean;
    onRetry: () => void;
}) {
    const [selectedTitle, setSelectedTitle] = useState('');

    const { startBuy, openLogin } = useContext(ModalActionsContext);
    const session = useSession();
    const { clients, loading: accountsLoading, selectedAccountId } =
        usePppoeAccounts();
    const selectedAccount = clients.find(
        (client) => client.accountId === selectedAccountId,
    );

    // A category is always selected: fall back to the first one when the
    // selection is unset (packages still loading) or stale.
    const activeTitle =
        packages?.find(
            ([t]) => t.toLowerCase() === selectedTitle.toLowerCase(),
        )?.[0] ??
        packages?.[0]?.[0] ??
        '';

    const groupedPackages = getPackagesByTitle(activeTitle, packages ?? []);

    function initiateOrderFlow(pkg: Package) {
        const seed = {
            packageId: pkg.packageId,
            price: String(pkg.price),
        };

        if (session.data?.session) startBuy(seed);
        else openLogin(pkg.packageId, String(pkg.price));
    }

    if (!packages || packages.length === 0)
        return (
            <Paper shadow='xl' radius='lg' p='lg' mt='md' withBorder>
                {' '}
                <Stack gap='md' mt='md'>
                    <Text size='lg' fw={600}>
                        Available Packages
                    </Text>
                    {loading && !error ? (
                        <Group gap='sm'>
                            <Loader size='sm' />
                            <Text c='dimmed'>Loading available packages…</Text>
                        </Group>
                    ) : (
                        <Alert
                            color={error ? 'red' : 'orange'}
                            title={
                                error
                                    ? 'Could not load packages'
                                    : 'Warning'
                            }
                            icon={<AiOutlineExclamationCircle size={24} />}
                        >
                            <Stack gap='sm'>
                                <Text>
                                    {error ??
                                        'Could not find PPPoE packages. Contact the admin to make sure packages are available.'}
                                </Text>
                                {error ? (
                                    <Button
                                        variant='light'
                                        color='red'
                                        onClick={onRetry}
                                    >
                                        Try again
                                    </Button>
                                ) : null}
                            </Stack>
                        </Alert>
                    )}
                </Stack>
            </Paper>
        );

    return (
        <Paper shadow='xl' radius='lg' p='lg' withBorder>
            <Stack gap='md' mt='md'>
                <Text size='lg' fw={600}>
                    Available Packages
                </Text>

                {error ? (
                    <Alert color='orange' title='Showing saved packages'>
                        <Group justify='space-between' align='center'>
                            <Text size='sm'>{error}</Text>
                            <Button
                                size='xs'
                                variant='light'
                                color='orange'
                                onClick={onRetry}
                            >
                                Retry
                            </Button>
                        </Group>
                    </Alert>
                ) : null}

                <SimpleGrid
                    cols={{ base: 2, xs: 3, sm: 4, md: 5 }}
                    spacing='md'
                >
                    {packages.map(([title, _]) => {
                        const active =
                            title.toLowerCase() === activeTitle.toLowerCase();
                        return (
                            <Button
                                key={title}
                                variant={active ? 'filled' : 'light'}
                                onClick={() => setSelectedTitle(title)}
                            >
                                {upperFirstCase(title)}
                            </Button>
                        );
                    })}
                </SimpleGrid>

                <Stack gap='md'>
                    {groupedPackages.map((pkg) => {
                        const downloadRate = formatPackageRate(
                            pkg.downloadRate,
                        );
                        const expiry = pkg.noExpiry
                            ? 'No Expiry'
                            : dayjs.duration(pkg.sessionLength, 'm').humanize();

                        return (
                            <Card
                                key={pkg.packageId}
                                shadow='sm'
                                radius='lg'
                                withBorder
                            >
                                <Stack gap='md'>
                                    <Group
                                        justify='space-between'
                                        align='flex-start'
                                    >
                                        <Stack gap='xs'>
                                            <Text c='dimmed'>
                                                {upperFirstCase(pkg.title)}
                                            </Text>
                                            <Text size='32px' fw={700}>
                                                {downloadRate}
                                            </Text>
                                        </Stack>

                                        <Stack gap='xs' align='flex-end'>
                                            <Text size='sm' c='dimmed'>
                                                {expiry}
                                            </Text>
                                            <Text size='xl' fw={700}>
                                                {formatPackagePrice(pkg.price)}
                                            </Text>
                                        </Stack>
                                    </Group>

                                    <Button
                                        fullWidth
                                        loading={
                                            Boolean(session.data?.session) &&
                                            accountsLoading
                                        }
                                        disabled={
                                            Boolean(session.data?.session) &&
                                            Boolean(selectedAccount) &&
                                            selectedAccount?.status !== 'active'
                                        }
                                        onClick={() => initiateOrderFlow(pkg)}
                                    >
                                        {pkg.price === 0 ? 'Activate' : 'Buy Now'}
                                    </Button>
                                </Stack>
                            </Card>
                        );
                    })}
                </Stack>
            </Stack>
        </Paper>
    );
}
