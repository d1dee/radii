import { Button, Group, Stack, Text } from '@mantine/core';
import { ClientContext, SessionContext } from '../Main.tsx';

import { useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export function UserSession({
    havingIssues,
}: {
    havingIssues: [boolean, Dispatch<SetStateAction<boolean>>];
}) {
    const client = useContext(ClientContext);
    const session = useContext(SessionContext);
    const [havingIssuesVal, setHavingIssues] = havingIssues;
    return (
        <Stack gap="xs" w="100%">
            <Text size="xl" fw={600}>
                Hello,
            </Text>

            <Group justify="space-between">
                <Text size="sm" c="gray.3">
                    {client?.phoneNumber}
                </Text>

                <Button
                    variant="subtle"
                    color="gray.1"
                    onClick={() => {
                        session && setHavingIssues(!havingIssuesVal);
                    }}
                >
                    {!havingIssuesVal ? 'Having issues?' : 'Active package'}
                </Button>
            </Group>
        </Stack>
    );
}
