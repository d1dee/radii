import { Alert, Avatar, Button, Flex, Paper, Stack } from '@mantine/core';
import type { Dispatch, SetStateAction } from 'react';
import { useSession } from '../../lib/auth.ts';
import {
    loadPppoePortal,
    useNasScope,
    usePppoePortal,
} from '../../lib/store.ts';
import { SigninSignup } from './SignedOutHeader.tsx';
import { UserSession } from './UserSession.tsx';

export function UserAccount({
    havingIssues,
}: {
    havingIssues: [boolean, Dispatch<SetStateAction<boolean>>];
}) {
    const { data } = useSession();
    const { clientError, contactsError } = usePppoePortal();
    const { nasDeviceId } = useNasScope();

    return (
        <Stack gap='sm'>
            {clientError || contactsError ? (
                <Alert
                    color='orange'
                    title='Some account information is unavailable'
                >
                    <Stack gap='sm'>
                        {clientError ?? contactsError}
                        <Button
                            size='xs'
                            variant='light'
                            color='orange'
                            onClick={() =>
                                void loadPppoePortal(
                                    data?.user.id ?? null,
                                    nasDeviceId,
                                    true,
                                )
                            }
                        >
                            Try again
                        </Button>
                    </Stack>
                </Alert>
            ) : null}
            <Paper
                shadow='xl'
                radius='lg'
                p='md'
                bg='grape.6'
                c='white'
                mt='md'
            >
                <Flex gap='md' justify='space-between'>
                    <Avatar
                        size={100}
                        color='grape.8'
                        variant='filled'
                        radius='xl'
                    />
                    {data?.session ? (
                        <UserSession havingIssues={havingIssues} />
                    ) : (
                        <SigninSignup />
                    )}
                </Flex>
            </Paper>
        </Stack>
    );
}
