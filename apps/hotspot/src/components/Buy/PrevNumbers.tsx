import { Paper, Stack, Text } from '@mantine/core';
import { useContext } from 'react';
import { ClientContext } from '../Main.tsx';
import { PrevPaymentMethods } from './PrevPaymentMethods.tsx';

export function PreviousNumbers() {
    const client = useContext(ClientContext);
    return (
        <Paper shadow="sm" radius="md" p="lg" withBorder>
            <Stack gap="md">
                <Text fw={600}>Saved Numbers:</Text>
                {client && client.prevPaymentMethods.length > 0 ? (
                    <PrevPaymentMethods />
                ) : (
                    <NoPrevPaymentMethod />
                )}
            </Stack>
        </Paper>
    );
}

function NoPrevPaymentMethod() {
    return (
        <Paper
            bg="red.0"
            p="lg"
            radius="md"
            withBorder
            style={{ borderColor: 'var(--mantine-color-red-4)' }}
        >
            <Text size="sm" c="dimmed">
                No valid payment method
            </Text>
        </Paper>
    );
}
