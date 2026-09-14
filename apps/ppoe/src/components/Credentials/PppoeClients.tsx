import {
    Alert,
    Anchor,
    Badge,
    Button,
    Card,
    Group,
    Loader,
    Paper,
    Stack,
    Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import {
    deauthDevice,
    rotateClientPassword,
} from '../../lib/api.ts';
import { useSession } from '../../lib/auth.ts';
import {
    refreshPppoeAccounts,
    refreshPppoeQuota,
    usePppoeAccounts,
} from '../../lib/store.ts';
import { CredentialsCard } from './CredentialsCard.tsx';

// The caller's PPPoE dialer accounts: credentials and dialer configuration
// for each active package, with password rotation and session disconnect.
export function PppoeClients() {
    const { data: session } = useSession();
    const { clients, config } = usePppoeAccounts();
    const [rotating, setRotating] = useState<string | null>(null);
    const [disconnecting, setDisconnecting] = useState<string | null>(null);

    useEffect(() => {
        if (session?.session) void refreshPppoeAccounts();
    }, [session?.session]);

    if (!session?.session) return null;

    const rotate = async (id: string) => {
        setRotating(id);
        try {
            const res = await rotateClientPassword(id);
            if (res.success) {
                notifications.show({
                    color: 'green',
                    title: 'Password rotated',
                    message:
                        'Update your router with the new password — live sessions were disconnected.',
                });
                await refreshPppoeAccounts();
            } else {
                notifications.show({
                    color: 'red',
                    title: 'Could not rotate password',
                    message: res.message || 'Try again.',
                });
            }
        } finally {
            setRotating(null);
        }
    };

    const disconnect = async (id: string) => {
        setDisconnecting(id);
        try {
            const res = await deauthDevice(id);
            if (res.success) {
                notifications.show({
                    color: 'green',
                    title: 'Disconnected',
                    message: 'The session was disconnected.',
                });
                await Promise.all([
                    refreshPppoeAccounts(),
                    refreshPppoeQuota(),
                ]);
            } else {
                notifications.show({
                    color: 'red',
                    title: 'Disconnect failed',
                    message: res.message || 'Try again.',
                });
            }
        } finally {
            setDisconnecting(null);
        }
    };

    return (
        <Paper shadow='xl' radius='lg' p='lg' withBorder>
            <Stack gap='md'>
                <Group justify='space-between'>
                    <Text size='lg' fw={600}>
                        Your PPPoE Accounts
                    </Text>
                    <Anchor
                        component='button'
                        type='button'
                        onClick={() => void refreshPppoeAccounts()}
                    >
                        Refresh
                    </Anchor>
                </Group>

                {clients.length === 0 ? (
                    <Alert color='red' variant='light' title='No active PPPoE package'>
                        Buy a package below, then configure your router or
                        phone dialer with the credentials shown here.
                    </Alert>
                ) : (
                    clients.map((client) => (
                        <Card key={client.activationId} radius='lg' withBorder>
                            <Stack gap='sm'>
                                <Group justify='space-between'>
                                    <Group gap='xs'>
                                        <Text size='md' fw={600}>
                                            {client.packageTitle}
                                        </Text>
                                        <Badge
                                            color={
                                                client.online ? 'green' : 'gray'
                                            }
                                            variant='light'
                                        >
                                            {client.online
                                                ? 'Online'
                                                : 'Offline'}
                                        </Badge>
                                    </Group>
                                    {client.online ? (
                                        <Anchor
                                            component='button'
                                            type='button'
                                            size='sm'
                                            c='red'
                                            onClick={() =>
                                                disconnect(
                                                    client.activationId,
                                                )
                                            }
                                        >
                                            {disconnecting ===
                                            client.activationId ? (
                                                <Group
                                                    gap='xs'
                                                    wrap='nowrap'
                                                >
                                                    <Loader size={14} />
                                                    <Text size='sm' c='dimmed'>
                                                        Disconnecting…
                                                    </Text>
                                                </Group>
                                            ) : (
                                                'Disconnect'
                                            )}
                                        </Anchor>
                                    ) : null}
                                </Group>

                                <CredentialsCard
                                    username={client.username}
                                    password={client.password}
                                    config={config}
                                />

                                <Group justify='space-between'>
                                    <Text size='xs' c='dimmed'>
                                        Expires:{' '}
                                        {new Date(
                                            client.expireAt,
                                        ).toLocaleString()}
                                    </Text>
                                    <Button
                                        size='xs'
                                        variant='light'
                                        color='orange'
                                        loading={
                                            rotating === client.activationId
                                        }
                                        onClick={() => rotate(client.activationId)}
                                    >
                                        Rotate password
                                    </Button>
                                </Group>
                            </Stack>
                        </Card>
                    ))
                )}
            </Stack>
        </Paper>
    );
}
