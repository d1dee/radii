import {
    Badge,
    Button,
    Group,
    Modal,
    Paper,
    Select,
    Stack,
    Text,
} from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import {
    selectPppoeAccount,
    usePppoeAccounts,
} from '../../lib/store.ts';

export function AccountSwitcher() {
    const { clients, loading, selectedAccountId } = usePppoeAccounts();
    const prompted = useRef(false);
    const [chooserOpened, setChooserOpened] = useState(false);

    useEffect(() => {
        if (!loading && clients.length > 1 && !prompted.current) {
            prompted.current = true;
            setChooserOpened(true);
        }
    }, [clients.length, loading]);

    if (loading || clients.length < 2) return null;

    const selected = clients.find(
        (client) => client.accountId === selectedAccountId,
    );

    return (
        <>
        <Paper shadow='xl' radius='lg' p='md' withBorder>
            <Stack gap='xs'>
                <Group justify='space-between' align='flex-end'>
                    <Text fw={600}>Service account</Text>
                    {selected ? (
                        <Badge
                            color={selected.online ? 'green' : 'gray'}
                            variant='light'
                        >
                            {selected.online ? 'Online' : selected.status}
                        </Badge>
                    ) : null}
                </Group>
                <Select
                    aria-label='Select PPPoE service account'
                    value={selectedAccountId}
                    onChange={(value) => value && selectPppoeAccount(value)}
                    allowDeselect={false}
                    data={clients.map((client) => ({
                        value: client.accountId,
                        label: `${client.label || client.username} - ${client.tenantName}`,
                    }))}
                />
                <Text size='xs' c='dimmed'>
                    Package details, credentials, and sessions apply to this
                    account. New purchases remain tied to this portal's network.
                </Text>
            </Stack>
        </Paper>
        <Modal
            opened={chooserOpened}
            onClose={() => setChooserOpened(false)}
            title='Choose a PPPoE account'
            centered
        >
            <Stack>
                <Text size='sm' c='dimmed'>
                    Select the service account you want to manage. You can
                    switch again at any time.
                </Text>
                {clients.map((client) => (
                    <Button
                        key={client.accountId}
                        variant={
                            client.accountId === selectedAccountId
                                ? 'filled'
                                : 'light'
                        }
                        justify='space-between'
                        onClick={() => {
                            selectPppoeAccount(client.accountId);
                            setChooserOpened(false);
                        }}
                    >
                        <span>{client.label || client.username}</span>
                        <span>{client.tenantName}</span>
                    </Button>
                ))}
            </Stack>
        </Modal>
        </>
    );
}
