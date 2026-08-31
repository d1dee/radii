import { Avatar, Flex, Paper } from '@mantine/core';
import type { Dispatch, SetStateAction } from 'react';
import { useSession } from '../../lib/auth.ts';
import { SigninSignup } from './SignedOutHeader.tsx';
import { UserSession } from './UserSession.tsx';

export function UserAccount({
    havingIssues,
}: {
    havingIssues: [boolean, Dispatch<SetStateAction<boolean>>];
}) {
    const { data } = useSession();
    return (
        <Paper shadow='xl' radius='lg' p='md' bg='grape.6' c='white' mt='md'>
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
    );
}
