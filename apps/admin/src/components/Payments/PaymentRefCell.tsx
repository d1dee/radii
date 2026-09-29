import { Stack, Text } from '@mantine/core';

import { formatPaymentReference } from '@/lib/format';

// Table cell for a payment reference: provider label on top, the raw
// transaction code as small faint subtext (omitted for free purchases).
export function PaymentRefCell({
    provider,
    providerTransactionId,
}: {
    provider: string | null;
    providerTransactionId: string | null;
}) {
    const ref = formatPaymentReference(provider, providerTransactionId);
    return (
        <Stack gap={0}>
            <Text size='sm'>{ref.label}</Text>
            {ref.code ? (
                <Text size='xs' c='dimmed' truncate maw={200} title={ref.code}>
                    {ref.code}
                </Text>
            ) : null}
        </Stack>
    );
}
