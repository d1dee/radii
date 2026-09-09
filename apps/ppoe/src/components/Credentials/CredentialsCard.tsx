import {
    ActionIcon,
    Code,
    CopyButton,
    Group,
    Stack,
    Text,
    TextInput,
    Tooltip,
} from '@mantine/core';
import type { PppoeServiceConfig } from '@radii/shared';
import { useState } from 'react';
import { AiOutlineCheck, AiOutlineCopy, AiOutlineEye } from 'react-icons/ai';

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
    password: string;
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
                value={password}
                readOnly
                rightSection={
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
