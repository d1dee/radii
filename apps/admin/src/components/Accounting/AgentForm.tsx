import {
    Alert,
    Button,
    Group,
    Modal,
    Stack,
    Textarea,
    TextInput,
} from '@mantine/core';
import { useState } from 'react';
import { createAgent, updateAgent, type Agent } from '@/lib/accountingApi';

export function AgentForm({
    agent,
    onClose,
    onSaved,
}: {
    agent?: Agent;
    onClose: () => void;
    onSaved: (agent: Agent) => void;
}) {
    const [name, setName] = useState(agent?.name ?? '');
    const [phone, setPhone] = useState(agent?.phone ?? '');
    const [notes, setNotes] = useState(agent?.notes ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (busy) return;
        if (!name.trim() || name.trim().length > 200) {
            setError('Enter an agent name of 1 to 200 characters.');
            return;
        }
        if (phone.trim() && !/^\+?[\d ()-]{5,39}$/.test(phone.trim())) {
            setError('Enter a valid contact phone number.');
            return;
        }
        if (notes.length > 4000) {
            setError('Notes must be 4000 characters or fewer.');
            return;
        }
        setBusy(true);
        setError('');
        const input = {
            name: name.trim(),
            phone: phone.trim(),
            notes: notes.trim(),
        };
        const result = agent
            ? await updateAgent(agent.id, input)
            : await createAgent(input);
        setBusy(false);
        if (!result.success || !result.data) {
            setError(
                result.success
                    ? 'The server returned no agent.'
                    : result.message,
            );
            return;
        }
        onSaved(result.data);
    }
    return (
        <Modal
            opened
            onClose={() => !busy && onClose()}
            title={agent ? 'Edit agent' : 'Create agent'}
            closeOnClickOutside={!busy}
            closeOnEscape={!busy}
        >
            <form onSubmit={submit}>
                <Stack>
                    {error && (
                        <Alert color='red' role='alert'>
                            {error}
                        </Alert>
                    )}
                    <TextInput
                        pb='xs'
                        label='Agent name'
                        required
                        maxLength={200}
                        value={name}
                        onChange={(event) => setName(event.currentTarget.value)}
                        disabled={busy}
                    />
                    <TextInput
                        pb='xs'
                        label='Contact phone'
                        description='Contact details only. This does not initiate a payout.'
                        descriptionProps={{ mb: 'xs' }}
                        maxLength={40}
                        value={phone}
                        onChange={(event) =>
                            setPhone(event.currentTarget.value)
                        }
                        disabled={busy}
                    />
                    <Textarea
                        pb='xs'
                        label='Internal notes'
                        maxLength={4000}
                        value={notes}
                        onChange={(event) =>
                            setNotes(event.currentTarget.value)
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
                            {agent ? 'Save agent' : 'Create agent'}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Modal>
    );
}
