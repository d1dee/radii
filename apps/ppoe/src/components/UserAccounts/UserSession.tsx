import { Button, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import type { Dispatch, SetStateAction } from 'react';
import { useContext, useState } from 'react';
import { ClientContext } from '../../App.tsx';
import { logout } from '../../lib/api.ts';
import { useSession } from '../../lib/auth.ts';
import { mutationLogger } from '../../lib/logging.ts';

export function UserSession({
    havingIssues,
}: {
    havingIssues: [boolean, Dispatch<SetStateAction<boolean>>];
}) {
    const client = useContext(ClientContext);
    const { data, refetch } = useSession();
    const [havingIssuesVal, setHavingIssues] = havingIssues;
    const [signingOut, setSigningOut] = useState(false);

    const signOut = async () => {
        setSigningOut(true);
        try {
            const result = await logout();
            if (!result.success) {
                mutationLogger.warning('Logout failed.', {
                    operation: 'logout',
                    errorType: result.type,
                });
                notifications.show({
                    color: 'red',
                    title: 'Could not sign out',
                    message: result.message || 'Try again.',
                });
                return;
            }
            await refetch();
        } catch (error) {
            mutationLogger.warning('Unexpected sign-out failure.', {
                operation: 'logout',
                errorName: error instanceof Error ? error.name : 'UnknownError',
            });
            notifications.show({
                color: 'red',
                title: 'Could not sign out',
                message: 'Check your connection and try again.',
            });
        } finally {
            setSigningOut(false);
        }
    };

    return (
        <Stack gap='xs' w='100%'>
            <Text size='xl' fw={600}>
                Hello,
            </Text>

            <Group justify='space-between'>
                <Text size='sm' c='gray.3'>
                    {client?.phoneNumber}
                </Text>

                <Group gap='xs'>
                    <Button
                        variant='subtle'
                        color='gray.1'
                        onClick={() => {
                            data?.session && setHavingIssues(!havingIssuesVal);
                        }}
                    >
                        {!havingIssuesVal ? 'Having issues?' : 'Active package'}
                    </Button>
                    <Button
                        variant='subtle'
                        color='gray.1'
                        loading={signingOut}
                        onClick={() => void signOut()}
                    >
                        Sign out
                    </Button>
                </Group>
            </Group>
        </Stack>
    );
}
