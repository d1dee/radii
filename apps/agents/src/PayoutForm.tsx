import {
    Alert,
    Button,
    Group,
    Modal,
    PasswordInput,
    Select,
    Stack,
    TextInput,
} from '@mantine/core';
import { PhoneNumberInput } from '@radii/ui';
import { useState } from 'react';
import { request } from './api';

export function PayoutForm({
    agentId,
    onClose,
    onSaved,
}: {
    agentId: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [method, setMethod] = useState<string | null>('mpesa');
    const [accountName, setAccountName] = useState('');
    const [destination, setDestination] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (busy) return;
        if (
            !method ||
            !accountName.trim() ||
            !destination.trim() ||
            !password
        ) {
            setError('Complete all payout details and confirm your password.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            await request(`/${agentId}/payout-profile`, {
                method,
                accountName: accountName.trim(),
                destination: destination.trim(),
                password,
            });
            onSaved();
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'Payout profile could not be submitted. Refresh before retrying.',
            );
        } finally {
            setBusy(false);
            setPassword('');
        }
    }
    return (
        <Modal
            opened
            onClose={() => !busy && onClose()}
            closeOnClickOutside={!busy}
            closeOnEscape={!busy}
            title='Submit payout destination'
            size='lg'
        >
            <form onSubmit={submit}>
                <Stack>
                    <Alert color='orange'>
                        Changes require operator verification before new
                        withdrawals. Existing withdrawals keep their original
                        destination. No money is transferred here.
                    </Alert>
                    {error && (
                        <Alert color='red' role='alert'>
                            {error}
                        </Alert>
                    )}
                    <Select
                        pb='xs'
                        label='Payout method'
                        data={[
                            { value: 'mpesa', label: 'M-Pesa' },
                            { value: 'bank', label: 'Bank' },
                        ]}
                        value={method}
                        allowDeselect={false}
                        disabled={busy}
                        onChange={(value) => {
                            setMethod(value);
                            setDestination('');
                        }}
                    />
                    <TextInput
                        pb='xs'
                        label='Account holder name'
                        required
                        maxLength={200}
                        autoComplete='name'
                        value={accountName}
                        onChange={(event) =>
                            setAccountName(event.currentTarget.value)
                        }
                        disabled={busy}
                    />
                    {method === 'mpesa' ? (
                        <PhoneNumberInput
                            pb='xs'
                            label='Payout phone number'
                            required
                            value={destination}
                            onChange={(value) => setDestination(value || '')}
                            disabled={busy}
                        />
                    ) : (
                        <TextInput
                            pb='xs'
                            label='Bank destination'
                            description='Include the bank and account details your operator needs to verify the destination.'
                            required
                            maxLength={300}
                            minLength={3}
                            value={destination}
                            onChange={(event) =>
                                setDestination(event.currentTarget.value)
                            }
                            disabled={busy}
                        />
                    )}
                    <PasswordInput
                        pb='xs'
                        label='Confirm your password'
                        autoComplete='current-password'
                        required
                        maxLength={128}
                        value={password}
                        onChange={(event) =>
                            setPassword(event.currentTarget.value)
                        }
                        disabled={busy}
                    />
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            onClick={onClose}
                            disabled={busy}
                        >
                            Cancel
                        </Button>
                        <Button type='submit' loading={busy}>
                            Submit for verification
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Modal>
    );
}
