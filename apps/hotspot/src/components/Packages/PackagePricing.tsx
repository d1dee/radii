import {
    Alert,
    Button,
    Card,
    Group,
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
import type { Package, Packages } from '../../types/index.ts';

export const dataScale = new humanFormat.Scale({
    Kbps: 1,
    Mbps: 1e3,
    Gbps: 1e6,
});

function getPackagesByTitle(title: string, packages: Packages) {
    const h = packages.find(
        ([t, _]) => t.toLowerCase() === title.toLowerCase(),
    );
    return h ? h[1] : [];
}

export function PackagePricing({
    packages,
}: {
    packages: Packages | undefined;
}) {
    const [selectedTitle, setSelectedTitle] = useState('');

    const { startBuy, openLogin } = useContext(ModalActionsContext);
    const session = useSession();

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
                    <Alert
                        color='orange'
                        title='Warning'
                        icon={<AiOutlineExclamationCircle size={24} />}
                    >
                        Could not find packages linked with your current NAS.
                        Reconnect your wifi network to resolve.
                    </Alert>
                </Stack>
            </Paper>
        );

    return (
        <Paper shadow='xl' radius='lg' p='lg' mt='md' withBorder>
            <Stack gap='md' mt='md'>
                <Text size='lg' fw={600}>
                    Available Packages
                </Text>

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
                                color={active ? 'grape' : 'gray'}
                                onClick={() => setSelectedTitle(title)}
                            >
                                {upperFirstCase(title)}
                            </Button>
                        );
                    })}
                </SimpleGrid>

                <Stack gap='md'>
                    {groupedPackages.map((pkg) => {
                        const title = pkg.downloadRate
                            ? humanFormat(pkg.downloadRate, {
                                  scale: dataScale,
                              })
                            : 'Unlimited';
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
                                            <Text c='dimmed'>{pkg.title}</Text>
                                            <Text size='32px' fw={700}>
                                                {title}
                                            </Text>
                                        </Stack>

                                        <Stack gap='xs' align='flex-end'>
                                            <Text size='sm' c='dimmed'>
                                                {expiry}
                                            </Text>
                                            <Text size='xl' fw={700}>
                                                Ksh {pkg.price.toLocaleString()}
                                            </Text>
                                        </Stack>
                                    </Group>

                                    <Button
                                        fullWidth
                                        onClick={() => initiateOrderFlow(pkg)}
                                    >
                                        Buy Now
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
