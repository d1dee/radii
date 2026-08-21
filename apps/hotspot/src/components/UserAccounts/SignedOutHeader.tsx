import { Anchor, Button, Group, Stack, Text } from '@mantine/core';
import { useContext } from 'react';
import { ModalActionsContext } from '../../App';

export function SigninSignup() {
    const { openRegister, openLogin } = useContext(ModalActionsContext);
    return (
        <Stack gap='sm' w='100%'>
            <Stack gap='sm'>
                <Text size='xl' fw={600}>
                    Hello,
                </Text>
                <Text size='sm' c='gray.3'>
                    Sign in or{' '}
                    <Anchor
                        component='button'
                        type='button'
                        c='gray.1'
                        onClick={() => openRegister()}
                    >
                        create an account
                    </Anchor>{' '}
                    to continue.
                </Text>
            </Stack>
            <Group justify='flex-end'>
                <Button variant='filled' onClick={() => openLogin()}>
                    Sign in
                </Button>
            </Group>
        </Stack>
    );
}
