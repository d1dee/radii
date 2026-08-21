import { Group, Paper, Radio, Stack, Text } from '@mantine/core';
import { parseServiceProvider } from '@radii/shared';
import { useContext } from 'react';
import { ClientContext } from '../Main.tsx';

export function PrevPaymentMethods({
    selectedPhone,
    onSelect,
}: {
    selectedPhone: string;
    onSelect: (phone: string) => void;
}) {
    const client = useContext(ClientContext);
    const prevPaymentMethods = client?.prevPaymentMethods ?? [];

    const phones = client?.phoneNumber
        ? [...new Set([...prevPaymentMethods, client.phoneNumber])]
        : prevPaymentMethods;

    return (
        <Stack gap='sm' pt='xs'>
            {phones.map((phone, i) => {
                const provider = parseServiceProvider(phone);
                const isSafaricom = provider?.name === 'safaricom';
                const logo = provider?.logo ?? '';
                const isSelected = selectedPhone === phone;

                return (
                    <Paper
                        key={i}
                        p={{ base: 'sm', md: 'md' }}
                        radius='lg'
                        withBorder
                        style={{
                            cursor: isSafaricom ? 'pointer' : 'not-allowed',
                            borderColor: isSafaricom
                                ? 'rgba(0, 255, 0, 0.3)'
                                : 'rgba(255, 0, 0, 0.3)',
                            backgroundColor: isSafaricom
                                ? 'rgba(0, 255, 0, 0.1)'
                                : 'rgba(255, 0, 0, 0.1)',
                        }}
                        onClick={
                            isSafaricom ? () => onSelect(phone) : undefined
                        }
                    >
                        <Group justify='space-between' wrap='nowrap'>
                            <Group gap='md'>
                                <Radio
                                    checked={isSelected}
                                    disabled={!isSafaricom}
                                    onChange={() => onSelect(phone)}
                                    value={phone}
                                    size='md'
                                />
                                <Text size='md' fw={500}>
                                    {phone}
                                </Text>
                            </Group>
                            {logo ? (
                                <img
                                    src={logo}
                                    alt='Logo'
                                    style={{
                                        height: '1.5rem',
                                        objectFit: 'contain',
                                    }}
                                />
                            ) : null}
                        </Group>
                    </Paper>
                );
            })}
        </Stack>
    );
}
