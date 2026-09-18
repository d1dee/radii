import {
    ActionIcon,
    Alert,
    Anchor,
    Badge,
    Button,
    Code,
    Collapse,
    CopyButton,
    Group,
    Loader,
    Modal,
    Paper,
    Select,
    Stack,
    Text,
    TextInput,
    Tooltip,
    UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { PppoeServiceConfig } from '@radii/shared';
import { useEffect, useRef, useState } from 'react';
import {
    AiOutlineCheck,
    AiOutlineDown,
    AiOutlineUp,
    AiOutlineCopy,
    AiOutlineEye,
} from 'react-icons/ai';
import { deauthDevice, rotateClientPassword } from '../../lib/api.ts';
import { useSession } from '../../lib/auth.ts';
import {
    refreshPppoeAccounts,
    refreshPppoeQuota,
    selectPppoeAccount,
    useNasScope,
    usePppoeAccounts,
} from '../../lib/store.ts';

// Single card for the selected PPPoE service account: the account switcher is
// always visible, while credentials, live-session controls, and package
// details live under an expandable section.
export function PppoeAccountCard() {
    const { data: session } = useSession();
    const { clients, config, loading, selectedAccountId } = usePppoeAccounts();
    const { nasDeviceId } = useNasScope();
    const [rotating, setRotating] = useState<string | null>(null);
    const [disconnecting, setDisconnecting] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [chooserOpened, setChooserOpened] = useState(false);
    const prompted = useRef(false);

    // Refresh on sign-in and on every network change so availability
    // (availableOnPortal) reflects the NAS the portal is scoped to.
    useEffect(() => {
        if (session?.session) void refreshPppoeAccounts();
    }, [session?.session, nasDeviceId]);

    // First-visit chooser when the customer has multiple service accounts.
    useEffect(() => {
        if (!loading && clients.length > 1 && !prompted.current) {
            prompted.current = true;
            setChooserOpened(true);
        }
    }, [clients.length, loading]);

    if (!session?.session) return null;

    const selected = clients.find(
        (client) => client.accountId === selectedAccountId,
    );

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
        <Paper shadow='xl' radius='lg' p='md' withBorder>
            <Stack gap='sm'>
                <Group justify='space-between' align='flex-end' wrap='nowrap'>
                    <Text fw={600}>Service account</Text>
                    <Group gap='xs' wrap='nowrap'>
                        {selected ? (
                            <Badge
                                color={selected.online ? 'green' : 'gray'}
                                variant='light'
                            >
                                {selected.online
                                    ? 'Online'
                                    : selected.status}
                            </Badge>
                        ) : null}
                        <Anchor
                            component='button'
                            type='button'
                            size='sm'
                            onClick={() => void refreshPppoeAccounts()}
                        >
                            Refresh
                        </Anchor>
                    </Group>
                </Group>

                {loading ? (
                    <Group justify='center' py='md'>
                        <Loader size='sm' />
                        <Text size='sm' c='dimmed'>
                            Loading service accounts...
                        </Text>
                    </Group>
                ) : clients.length === 0 ? (
                    <Alert
                        color='red'
                        variant='light'
                        title='No active PPPoE package'
                    >
                        Buy a package below, then configure your router or
                        phone dialer with the credentials shown here.
                    </Alert>
                ) : (
                    <>
                        <Select
                            aria-label='Select PPPoE service account'
                            value={selectedAccountId}
                            onChange={(value) =>
                                value && selectPppoeAccount(value)
                            }
                            allowDeselect={false}
                            data={clients.map((client) => ({
                                value: client.accountId,
                                label: `${client.label || client.username} - ${client.tenantName}`,
                            }))}
                        />

                        {selected ? (
                            <>
                                <UnstyledButton
                                    onClick={() => setExpanded((v) => !v)}
                                    aria-expanded={expanded}
                                    aria-controls='pppoe-account-details'
                                >
                                    <Group
                                        justify='space-between'
                                        wrap='nowrap'
                                        gap='xs'
                                    >
                                        <Text size='sm' fw={500}>
                                            Credentials & session details
                                        </Text>
                                        {expanded ? (
                                            <AiOutlineUp size={16} />
                                        ) : (
                                            <AiOutlineDown size={16} />
                                        )}
                                    </Group>
                                </UnstyledButton>

                                <Collapse
                                    expanded={expanded}
                                    id='pppoe-account-details'
                                >
                                    <Stack gap='sm' pt='xs'>
                                        {selected.online &&
                                        selected.activeActivation ? (
                                            <Group justify='flex-end'>
                                                <Anchor
                                                    component='button'
                                                    type='button'
                                                    size='sm'
                                                    c='red'
                                                    onClick={() =>
                                                        disconnect(
                                                            selected.accountId,
                                                        )
                                                    }
                                                >
                                                    {disconnecting ===
                                                    selected.accountId ? (
                                                        <Group
                                                            gap='xs'
                                                            wrap='nowrap'
                                                        >
                                                            <Loader size={14} />
                                                            <Text
                                                                size='sm'
                                                                c='dimmed'
                                                            >
                                                                Disconnecting…
                                                            </Text>
                                                        </Group>
                                                    ) : (
                                                        'Disconnect session'
                                                    )}
                                                </Anchor>
                                            </Group>
                                        ) : null}

                                        <CredentialsCard
                                            username={selected.username}
                                            password={selected.password}
                                            config={config}
                                            packageTitle={
                                                selected.activeActivation
                                                    ?.packageTitle
                                            }
                                        />

                                        <Group justify='space-between'>
                                            <Text size='xs' c='dimmed'>
                                                {selected.activeActivation
                                                    ? `Expires: ${new Date(
                                                          selected.activeActivation.expireAt,
                                                      ).toLocaleString()}`
                                                    : selected.lastUsedAt
                                                      ? `Last used: ${new Date(
                                                            selected.lastUsedAt,
                                                        ).toLocaleString()}`
                                                      : 'No active package'}
                                            </Text>
                                            <Button
                                                size='xs'
                                                variant='light'
                                                color='orange'
                                                loading={
                                                    rotating ===
                                                    selected.accountId
                                                }
                                                disabled={
                                                    selected.status !==
                                                        'active' ||
                                                    !selected.activeActivation
                                                }
                                                onClick={() =>
                                                    rotate(selected.accountId)
                                                }
                                            >
                                                Rotate password
                                            </Button>
                                        </Group>
                                    </Stack>
                                </Collapse>
                            </>
                        ) : null}
                    </>
                )}
            </Stack>

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
        </Paper>
    );
}

// Dialer credentials with copy/reveal controls — the PPPoE equivalent of the
// hotspot servlet redirect hop: these values are what the customer enters
// into their router/phone PPPoE dialer.
export function CredentialsCard({
    username,
    password,
    config,
    packageTitle,
}: {
    username: string;
    password: string | null;
    config?: PppoeServiceConfig | null;
    packageTitle?: string;
}) {
    const [revealed, setRevealed] = useState(false);

    return (
        <Stack gap='sm' w='100%'>
            {packageTitle ? (
                <Text size='sm' fw={600}>
                    {packageTitle}
                </Text>
            ) : null}

            <TextInput
                label='PPPoE Username'
                value={username}
                readOnly
                rightSection={<CopyControl value={username} />}
            />

            <TextInput
                label='PPPoE Password'
                type={revealed ? 'text' : 'password'}
                value={password ?? 'Not provisioned'}
                readOnly
                rightSection={password ? (
                    <Group gap={4} wrap='nowrap'>
                        <Tooltip
                            label={revealed ? 'Hide password' : 'Show password'}
                        >
                            <ActionIcon
                                variant='subtle'
                                color='gray'
                                onClick={() => setRevealed((v) => !v)}
                            >
                                <AiOutlineEye size={16} />
                            </ActionIcon>
                        </Tooltip>
                        <CopyControl value={password} />
                    </Group>
                ) : null}
            />

            {config ? (
                <Stack gap='xs'>
                    <Group justify='space-between'>
                        <Text size='xs' c='dimmed'>
                            Service name
                        </Text>
                        <Code>{config.serviceName || '(any)'}</Code>
                    </Group>
                    <Group justify='space-between'>
                        <Text size='xs' c='dimmed'>
                            MTU / MRU
                        </Text>
                        <Code>
                            {config.mtu} / {config.mru}
                        </Code>
                    </Group>
                    <Group justify='space-between'>
                        <Text size='xs' c='dimmed'>
                            DNS
                        </Text>
                        <Code>{config.dns.join(', ')}</Code>
                    </Group>
                </Stack>
            ) : null}

            <Text size='xs' c='dimmed'>
                Configure these credentials on your router or phone PPPoE
                dialer to connect.
            </Text>
        </Stack>
    );
}

function CopyControl({ value }: { value: string }) {
    return (
        <CopyButton value={value} timeout={2000}>
            {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy'}>
                    <ActionIcon
                        variant='subtle'
                        color={copied ? 'teal' : 'gray'}
                        onClick={copy}
                    >
                        {copied ? (
                            <AiOutlineCheck size={16} />
                        ) : (
                            <AiOutlineCopy size={16} />
                        )}
                    </ActionIcon>
                </Tooltip>
            )}
        </CopyButton>
    );
}
