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

// Stable PPPoE service accounts, ordered with active and online accounts first.
export function PppoeClients() {
    const { data: session } = useSession();
    const { clients, config, loading, selectedAccountId } = usePppoeAccounts();
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
            const client = clients.find((value) => value.accountId === id);
            const activationId = client?.activeActivation?.activationId;
            if (!activationId) return;
            const res = await deauthDevice(activationId, id);
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

                {loading ? (
                    <Group justify='center' py='md'>
                        <Loader size='sm' />
                        <Text size='sm' c='dimmed'>
                            Loading service accounts...
                        </Text>
                    </Group>
                ) : clients.length === 0 ? (
                    <Alert color='red' variant='light' title='No active PPPoE package'>
                        Buy a package below, then configure your router or
                        phone dialer with the credentials shown here.
                    </Alert>
                ) : (
                    clients.map((client) => (
                        <Card
                            key={client.accountId}
                            radius='lg'
                            withBorder
                        >
                            <Stack gap='sm'>
                                <Group justify='space-between'>
                                    <Group gap='xs'>
                                        <Text size='md' fw={600}>
                                            {client.label || client.tenantName}
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
                                        <Badge
                                            color={
                                                client.status === 'active'
                                                    ? 'grape'
                                                    : 'orange'
                                            }
                                            variant='outline'
                                        >
                                            {client.status}
                                        </Badge>
                                        {client.accountId ===
                                        selectedAccountId ? (
                                            <Badge color='grape'>Selected</Badge>
                                        ) : null}
                                    </Group>
                                    {client.online &&
                                    client.activeActivation ? (
                                        <Anchor
                                            component='button'
                                            type='button'
                                            size='sm'
                                            c='red'
                                            onClick={() =>
                                                disconnect(client.accountId)
                                            }
                                        >
                                            {disconnecting ===
                                            client.accountId ? (
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
                                    packageTitle={
                                        client.activeActivation?.packageTitle
                                    }
                                />

                                <Group justify='space-between'>
                                    <Text size='xs' c='dimmed'>
                                        {client.activeActivation
                                            ? `Expires: ${new Date(
                                                  client.activeActivation.expireAt,
                                              ).toLocaleString()}`
                                            : client.lastUsedAt
                                              ? `Last used: ${new Date(
                                                    client.lastUsedAt,
                                                ).toLocaleString()}`
                                              : 'No active package'}
                                    </Text>
                                    <Button
                                        size='xs'
                                        variant='light'
                                        color='orange'
                                        loading={
                                            rotating === client.accountId
                                        }
                                        disabled={
                                            client.status !== 'active' ||
                                            !client.activeActivation
                                        }
                                        onClick={() => rotate(client.accountId)}
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
