import { Group, Paper, Radio, Stack, Text } from '@mantine/core';
import { useContext } from 'react';
import { parseServiceProvider } from '@radii/shared';
import { ClientContext } from '../Main.tsx';
import { RadioContext } from './Form.tsx';

function isSafaricom(phone: string) {
    const p = parseServiceProvider(phone);
    return !(p instanceof Error) && p.name === 'safaricom';
}

export function PrevPaymentMethods() {
    const [selectedPhone, setSelectedPhone] = useContext(RadioContext);
    const client = useContext(ClientContext);
    const prevPaymentMethods = client?.prevPaymentMethods || [];

    return (
        <Stack gap="sm">
            {prevPaymentMethods.map((prevPhoneNumber, i) => {
                const provider = parseServiceProvider(prevPhoneNumber);
                const providerError = provider instanceof Error;
                const providerName = providerError ? null : provider.name;
                const providerLogo = providerError ? '' : provider.logo;

                const inputChecked = selectedPhone
                    ? selectedPhone === prevPhoneNumber
                    : prevPaymentMethods.findIndex(isSafaricom) === i;

                if (providerName === 'safaricom') {
                    return (
                        <Paper
                            key={i}
                            p={{ base: 'sm', md: 'md' }}
                            radius="lg"
                            withBorder
                            style={{
                                cursor: 'pointer',
                                background:
                                    'var(--mantine-color-gray-0)',
                            }}
                            onClick={() => setSelectedPhone(prevPhoneNumber)}
                        >
                            <Stack
                                gap="xs"
                                align="stretch"
                                justify="space-between"
                            >
                                <Radio
                                    checked={inputChecked}
                                    onChange={() =>
                                        setSelectedPhone(prevPhoneNumber)
                                    }
                                    value={prevPhoneNumber}
                                    size="md"
                                />
                                <Group justify="space-between" wrap="nowrap">
                                    <Text size="md" fw={500}>
                                        {prevPhoneNumber}
                                    </Text>
                                    {providerLogo ? (
                                        <img
                                            src={providerLogo}
                                            alt="Logo"
                                            style={{
                                                height: '1.5rem',
                                                objectFit: 'contain',
                                            }}
                                        />
                                    ) : null}
                                </Group>
                            </Stack>
                        </Paper>
                    );
                }

                return (
                    <Paper
                        key={i}
                        p={{ base: 'sm', md: 'md' }}
                        radius="lg"
                        withBorder
                        bg="red.0"
                        style={{ opacity: 0.7 }}
                    >
                        <Stack gap="xs" justify="space-between">
                            <Radio disabled size="md" />
                            <Group justify="space-between" wrap="nowrap">
                                <Text size="md" fw={500}>
                                    {prevPhoneNumber}
                                </Text>
                                {providerLogo ? (
                                    <img
                                        src={providerLogo}
                                        alt="Logo"
                                        style={{
                                            height: '1.5rem',
                                            objectFit: 'contain',
                                            mixBlendMode:
                                                providerName === 'telkom'
                                                    ? 'exclusion'
                                                    : undefined,
                                        }}
                                    />
                                ) : null}
                            </Group>
                        </Stack>
                    </Paper>
                );
            })}
        </Stack>
    );
}
