import { Group, Paper, Radio, Stack, Text } from '@mantine/core';
import { parseServiceProvider } from '@radii/shared';
import { useContext } from 'react';
import { ClientContext } from '../Main.tsx';

export function PrevPaymentMethods({
    phoneNumber,
    inputMethod,
    setPhone,
}: {
    phoneNumber: string;
    inputMethod: 'radio' | 'input';
    setPhone: (phone: string, method: 'radio' | 'input') => void;
}) {
    const client = useContext(ClientContext);
    const prevPaymentMethods = client?.prevPaymentMethods
        ? [...client?.prevPaymentMethods, client.phoneNumber]
        : [];

    return (
        <Stack gap='sm' pt='xs'>
            {prevPaymentMethods.map((prevPhoneNumber, i) => {
                const provider = parseServiceProvider(prevPhoneNumber);
                const providerError = provider instanceof Error;
                const providerName = providerError ? null : provider.name;
                const providerLogo = providerError ? '' : provider.logo;

                const inputChecked =
                    inputMethod === 'radio' && phoneNumber === prevPhoneNumber;

                if (providerName === 'safaricom') {
                    return (
                        <Paper
                            key={i}
                            p={{ base: 'sm', md: 'md' }}
                            radius='lg'
                            withBorder
                            style={{
                                cursor: 'pointer',
                                background: 'var(--mantine-color-gray-0)',
                            }}
                            onClick={() => setPhone(prevPhoneNumber, 'radio')}
                        >
                            <Stack
                                gap='xs'
                                align='stretch'
                                justify='space-between'
                            >
                                <Group justify='space-between' wrap='nowrap'>
                                    <Group gap='md'>
                                        <Radio
                                            checked={inputChecked}
                                            onChange={() =>
                                                setPhone(
                                                    prevPhoneNumber,
                                                    'radio',
                                                )
                                            }
                                            value={prevPhoneNumber}
                                            size='md'
                                        />
                                        <Text size='md' fw={500}>
                                            {prevPhoneNumber}
                                        </Text>{' '}
                                    </Group>
                                    {providerLogo ? (
                                        <img
                                            src={providerLogo}
                                            alt='Logo'
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
                    <Paper shadow='sm' radius='md' p='lg' withBorder>
                        <Stack gap='md'>
                            <Text fw={600}>Non-M-Pesa Number</Text>
                            <Text size='sm' c='dimmed'>
                                Only M-Pesa numbers can be used
                            </Text>
                            <Paper
                                key={i}
                                p={{ base: 'sm', md: 'md' }}
                                radius='lg'
                                withBorder
                                bg='red.0'
                                style={{ opacity: 0.7 }}
                            >
                                <Stack gap='xs' justify='space-between'>
                                    <Group
                                        justify='space-between'
                                        wrap='nowrap'
                                    >
                                        <Radio disabled size='md' />
                                        <Text size='md' fw={500}>
                                            {prevPhoneNumber}
                                        </Text>
                                        {providerLogo ? (
                                            <img
                                                src={providerLogo}
                                                alt='Logo'
                                                style={{
                                                    height: '1.5rem',
                                                    objectFit: 'contain',
                                                    mixBlendMode:
                                                        providerName ===
                                                        'telkom'
                                                            ? 'exclusion'
                                                            : undefined,
                                                }}
                                            />
                                        ) : null}
                                    </Group>
                                </Stack>
                            </Paper>{' '}
                        </Stack>
                    </Paper>
                );
            })}
        </Stack>
    );
}
