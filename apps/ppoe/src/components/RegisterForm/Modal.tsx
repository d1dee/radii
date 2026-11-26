import { Button, Divider, Modal, Stack, Text } from '@mantine/core';
import { RegisterForm } from './Form.tsx';
import { ResetPinForm } from './ResetPinForm.tsx';

export type AuthMode = 'register' | 'login' | 'reset';

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
    mode: AuthMode;
    onModeChange: (mode: AuthMode) => void;
    packageId: string;
    price: string;
}) {
    function switchMode() {
        if (mode === 'reset') onModeChange('login');
        else onModeChange(mode === 'register' ? 'login' : 'register');
    }

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={
                mode === 'register'
                    ? 'Welcome!'
                    : mode === 'login'
                      ? 'Welcom back!'
                      : 'Reset your PIN'
            }
            size='lg'
            centered
        >
            <Stack gap='sm'>
                <Text size='sm' c='dimmed'>
                    {mode === 'register'
                        ? ' Create an account to manage your service anytime.'
                        : mode === 'login'
                          ? 'Login to your account to manage your service anytime.'
                          : 'We will text you a 6-digit code to set a new PIN.'}
                </Text>

                {mode === 'reset' ? (
                    <ResetPinForm
                        key='reset'
                        onBackToLogin={() => onModeChange('login')}
                    />
                ) : (
                    <RegisterForm
                        key={mode}
                        mode={mode}
                        packageId={packageId}
                        price={price}
                        onClose={onClose}
                    />
                )}

                {mode !== 'reset' ? <Divider label='or' /> : null}

                {mode !== 'reset' ? (
                    <Button variant='default' onClick={switchMode}>
                        {mode === 'login' ? 'Register' : 'Login'}
                    </Button>
                ) : null}

                {mode === 'login' ? (
                    <Button
                        variant='subtle'
                        size='xs'
                        onClick={() => onModeChange('reset')}
                    >
                        Forgot PIN?
                    </Button>
                ) : null}
            </Stack>
        </Modal>
    );
}
