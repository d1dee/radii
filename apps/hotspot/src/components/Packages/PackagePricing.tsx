import {
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
import {
    ModalActionsContext,
    PackagesContext,
    SessionContext,
} from '../Main.tsx';

import humanFormat from 'human-format';
import { useContext, useState } from 'react';
import type { Package } from '../../types/index.ts';

type Packages = [string, Array<Package>];

export const dataScale = new humanFormat.Scale({
    Kbps: 1,
    Mbps: 1e3,
    Gbps: 1e6,
});

function getPackages(title: string, packages: Array<Packages>) {
    const h = packages.find(
        ([t, _]) => t.toLowerCase() === title.toLowerCase(),
    );
    return h ? h[1] : [];
}

export function PackagePricing() {
    const pkgContext = useContext(PackagesContext);

    const [state, setState] = useState({
        selectedTitle: pkgContext[0][0],
        packages: pkgContext[0][1],
    });

    const { startBuy, openLogin } = useContext(ModalActionsContext);
    const session = useContext(SessionContext);
    const { selectedTitle, packages } = state;

    function initiateOrderFlow(pkg: Package) {
        const seed = {
            packageId: pkg.packageId,
            price: String(pkg.price),
        };

        if (session && session.expiresAt > Date.now()) startBuy(seed);
        else openLogin(pkg.packageId, String(pkg.price));
    }

    return (
        <Paper shadow='xl' radius='lg' p='lg' mt='md'>
            <Stack gap='md' mt='md'>
                <Text size='lg' fw={600}>
                    Our Packages
                </Text>

                <SimpleGrid
                    cols={{ base: 2, xs: 3, sm: 4, md: 5 }}
                    spacing='md'
                >
                    {pkgContext.map(([title, _]) => {
                        const active =
                            title.toLowerCase() === selectedTitle.toLowerCase();
                        return (
                            <Button
                                key={title}
                                variant={active ? 'filled' : 'light'}
                                color={active ? 'grape' : 'gray'}
                                onClick={() => {
                                    setState({
                                        selectedTitle: title,
                                        packages: getPackages(
                                            title,
                                            pkgContext,
                                        ),
                                    });
                                }}
                            >
                                {upperFirstCase(title)}
                            </Button>
                        );
                    })}
                </SimpleGrid>

                <Stack gap='md'>
                    {packages.map((pkg) => (
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
                                            {humanFormat(pkg.downloadRate, {
                                                scale: dataScale,
                                            })}
                                        </Text>
                                    </Stack>

                                    <Stack gap='xs' align='flex-end'>
                                        <Text size='sm' c='dimmed'>
                                            {dayjs
                                                .duration(
                                                    pkg.initialSessionLength,
                                                    'm',
                                                )
                                                .humanize()}
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
                    ))}
                </Stack>
            </Stack>
        </Paper>
    );
}
