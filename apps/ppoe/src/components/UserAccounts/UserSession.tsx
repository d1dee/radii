import { Button, Group, Stack, Text } from '@mantine/core';

import type { Dispatch, SetStateAction } from 'react';
import { useContext } from 'react';
import { ClientContext } from '../../App.tsx';
import { logout } from '../../lib/api.ts';
import { useSession } from '../../lib/auth.ts';

export function UserSession({
    havingIssues,
}: {
    havingIssues: [boolean, Dispatch<SetStateAction<boolean>>];
}) {
    const client = useContext(ClientContext);
    const { data, refetch } = useSession();
    const [havingIssuesVal, setHavingIssues] = havingIssues;

    const signOut = async () => {
        await logout();
        await refetch();
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
                        onClick={signOut}
                    >
                        Sign out
                    </Button>
                </Group>
            </Group>
        </Stack>
    );
}
