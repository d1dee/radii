import { Button, Divider, Modal, Stack, Text } from '@mantine/core';
import { RegisterForm } from './Form.tsx';

export function RegisterModal({
    opened,
    onClose,
    mode,
    onModeChange,
    packageId,
    price,
}: {
    opened: boolean;
    onClose: () => void;
    mode: 'register' | 'login';
    onModeChange: (mode: 'register' | 'login') => void;
    packageId: string;
    price: string;
}) {
    function switchMode() {
        onModeChange(mode === 'register' ? 'login' : 'register');
    }

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={mode === 'register' ? 'Welcome!' : 'Welcom back!'}
            size='md'
            centered
        >
            <Stack gap='sm'>
                <Text size='sm' c='dimmed'>
                    {mode === 'register' ? ' Create an ' : 'Login to your '}
                    account to manage your service anytime.
                </Text>
                <RegisterForm
                    key={mode}
                    mode={mode}
                    packageId={packageId}
                    price={price}
                    onClose={onClose}
                />

                <Divider label='or' />

                <Button variant='default' onClick={switchMode}>
                    {mode === 'login' ? 'Register' : 'Login'}
                </Button>
            </Stack>
        </Modal>
    );
}
