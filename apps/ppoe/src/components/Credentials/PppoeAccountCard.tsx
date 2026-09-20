import {
    ActionIcon,
    Alert,
    Anchor,
    Badge,
    Box,
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
import type { PppoeClient, PppoeServiceConfig } from '@radii/shared';
import { useEffect, useRef, useState } from 'react';
import {
    AiOutlineCheck,
    AiOutlineCopy,
    AiOutlineDown,
    AiOutlineEye,
    AiOutlineReload,
    AiOutlineUp,
} from 'react-icons/ai';
import { MdSettingsEthernet } from 'react-icons/md';
import { deauthDevice, rotateClientPassword } from '../../lib/api.ts';
import { useSession } from '../../lib/auth.ts';
import { mutationLogger } from '../../lib/logging.ts';
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
    const {
        clients,
        config,
        loading,
        selectedAccountId,
        error: accountsError,
    } = usePppoeAccounts();
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
    const accountOptions = clients.map((client) => ({
        value: client.accountId,
        label: `${accountName(client)} · ${client.nasName || client.tenantName}`,
    }));

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
        } catch (error) {
            mutationLogger.warning('Unexpected password rotation failure.', {
                operation: 'rotate-password',
                errorName: error instanceof Error ? error.name : 'UnknownError',
            });
            notifications.show({
                color: 'red',
                title: 'Could not rotate password',
                message: 'Something went wrong. Try again.',
            });
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
        } catch (error) {
            mutationLogger.warning('Unexpected session disconnect failure.', {
                operation: 'disconnect-session',
                errorName: error instanceof Error ? error.name : 'UnknownError',
            });
            notifications.show({
                color: 'red',
                title: 'Disconnect failed',
                message: 'Could not disconnect the session. Try again.',
            });
        } finally {
            setDisconnecting(null);
        }
    };

    return (
        <Paper shadow='xl' radius='lg' p='md' withBorder>
            <Stack gap='sm'>
                <Group justify='space-between' align='center' wrap='nowrap'>
                    <Box>
                        <Text fw={650}>Service account</Text>
                        <Text size='xs' c='dimmed'>
                            Choose the line you want to manage
                        </Text>
                    </Box>
                    <Tooltip label='Refresh service accounts'>
                        <ActionIcon
                            variant='subtle'
                            color='gray'
                            size='lg'
                            aria-label='Refresh service accounts'
                            loading={loading}
                            onClick={() => void refreshPppoeAccounts()}
                        >
                            <AiOutlineReload size={18} />
                        </ActionIcon>
                    </Tooltip>
                </Group>

                {loading ? (
                    <Group justify='center' py='md'>
                        <Loader size='sm' />
                        <Text size='sm' c='dimmed'>
                            Loading service accounts...
                        </Text>
                    </Group>
                ) : clients.length === 0 ? (
                    accountsError ? (
                        <Alert
                            color='red'
                            variant='light'
                            title='Could not load service accounts'
                        >
                            <Stack gap='sm'>
                                <Text size='sm'>{accountsError}</Text>
                                <Button
                                    size='xs'
                                    variant='light'
                                    color='red'
                                    onClick={() =>
                                        void refreshPppoeAccounts()
                                    }
                                >
                                    Try again
                                </Button>
                            </Stack>
                        </Alert>
                    ) : (
                        <Alert
                            color='red'
                            variant='light'
                            title='No active PPPoE package'
                        >
                            Buy a package below, then configure your router or
                            phone dialer with the credentials shown here.
                        </Alert>
                    )
                ) : (
                    <>
                        {accountsError ? (
                            <Alert
                                color='orange'
                                title='Showing saved accounts'
                            >
                                <Group justify='space-between' align='center'>
                                    <Text size='sm'>{accountsError}</Text>
                                    <Button
                                        size='xs'
                                        variant='light'
                                        color='orange'
                                        onClick={() =>
                                            void refreshPppoeAccounts()
                                        }
                                    >
                                        Retry
                                    </Button>
                                </Group>
                            </Alert>
                        ) : null}
                        <Select
                            aria-label='Select PPPoE service account'
                            value={selectedAccountId}
                            onChange={(value) =>
                                value && selectPppoeAccount(value)
                            }
                            allowDeselect={false}
                            data={accountOptions}
                            leftSection={<MdSettingsEthernet size={20} />}
                            leftSectionPointerEvents='none'
                            leftSectionWidth={46}
                            rightSection={
                                selected ? (
                                    <AccountStatus client={selected} />
                                ) : undefined
                            }
                            rightSectionPointerEvents='none'
                            rightSectionWidth={96}
                            maxDropdownHeight={360}
                            renderOption={({ option, checked }) => {
                                const client = clients.find(
                                    (value) => value.accountId === option.value,
                                );
                                return client ? (
                                    <AccountOption
                                        client={client}
                                        selected={Boolean(checked)}
                                    />
                                ) : (
                                    option.label
                                );
                            }}
                            styles={{
                                input: {
                                    minHeight: 58,
                                    paddingInlineStart: 46,
                                    paddingInlineEnd: 96,
                                    fontWeight: 600,
                                },
                            }}
                        />

                        {selected ? (
                            <Group gap={6} px={4} wrap='nowrap'>
                                <Text size='xs' c='dimmed' truncate>
                                    {selected.username}
                                </Text>
                                <Text size='xs' c='dimmed' aria-hidden='true'>
                                    ·
                                </Text>
                                <Text size='xs' c='dimmed' truncate>
                                    {selected.activeActivation?.packageTitle ??
                                        'No active package'}
                                </Text>
                            </Group>
                        ) : null}

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
                                                          selected
                                                              .activeActivation
                                                              .expireAt,
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
                title='Choose a service line'
                centered
                radius='lg'
            >
                <Stack gap='md'>
                    <Text size='sm' c='dimmed'>
                        Packages, credentials, and session details will follow
                        this selection. You can switch lines at any time.
                    </Text>
                    {clients.map((client) => (
                        <UnstyledButton
                            key={client.accountId}
                            p='sm'
                            style={(theme) => ({
                                border: `1px solid ${
                                    client.accountId === selectedAccountId
                                        ? theme.colors.grape[6]
                                        : 'var(--mantine-color-default-border)'
                                }`,
                                borderRadius: theme.radius.md,
                                background:
                                    client.accountId === selectedAccountId
                                        ? 'var(--mantine-color-grape-light)'
                                        : 'var(--mantine-color-body)',
                            })}
                            onClick={() => {
                                selectPppoeAccount(client.accountId);
                                setChooserOpened(false);
                            }}
                        >
                            <AccountOption
                                client={client}
                                selected={
                                    client.accountId === selectedAccountId
                                }
                            />
                        </UnstyledButton>
                    ))}
                </Stack>
            </Modal>
        </Paper>
    );
}

function accountName(client: PppoeClient) {
    return client.label?.trim() || client.username;
}

function accountState(client: PppoeClient) {
    if (client.online) return { color: 'green', label: 'Online' };
    if (client.status === 'suspended') {
        return { color: 'orange', label: 'Suspended' };
    }
    if (client.status === 'closed') return { color: 'red', label: 'Closed' };
    if (client.activeActivation) return { color: 'gray', label: 'Offline' };
    return { color: 'gray', label: 'No package' };
}

function AccountStatus({ client }: { client: PppoeClient }) {
    const state = accountState(client);
    return (
        <Badge color={state.color} variant='light' size='sm'>
            {state.label}
        </Badge>
    );
}

function AccountOption({
    client,
    selected,
}: {
    client: PppoeClient;
    selected: boolean;
}) {
    return (
        <Group wrap='nowrap' gap='sm' w='100%'>
            <Box
                c={client.online ? 'green.7' : 'gray.6'}
                bg={
                    client.online
                        ? 'var(--mantine-color-green-light)'
                        : 'var(--mantine-color-default-hover)'
                }
                p={8}
                style={{ borderRadius: '50%', lineHeight: 0 }}
            >
                <MdSettingsEthernet size={18} />
            </Box>
            <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                <Group gap={6} wrap='nowrap'>
                    <Text size='sm' fw={650} truncate>
                        {accountName(client)}
                    </Text>
                    {selected ? (
                        <AiOutlineCheck
                            size={14}
                            color='var(--mantine-color-grape-6)'
                            aria-label='Selected'
                        />
                    ) : null}
                </Group>
                <Text size='xs' c='dimmed' truncate>
                    {client.nasName || client.tenantName} · {client.username}
                </Text>
                <Text size='xs' c='dimmed' truncate>
                    {client.activeActivation?.packageTitle ??
                        'No active package'}
                </Text>
            </Stack>
            <AccountStatus client={client} />
        </Group>
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
                rightSection={
                    password ? (
                        <Group gap={4} wrap='nowrap'>
                            <Tooltip
                                label={
                                    revealed ? 'Hide password' : 'Show password'
                                }
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
                    ) : null
                }
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
                Configure these credentials on your router or phone PPPoE dialer
                to connect.
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
