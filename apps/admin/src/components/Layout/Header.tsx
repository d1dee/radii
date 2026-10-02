import {
    Burger,
    Avatar,
    Group,
    Menu,
    Stack,
    Text,
    UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { MdLogout, MdSettings } from 'react-icons/md';
import { useNavigate } from 'react-router-dom';

import { authClient, useSession } from '@/lib/auth';
import { reportClientError } from '@/lib/clientError';

interface HeaderProps {
    opened: boolean;
    onMenuClick: () => void;
}

export function Header({ opened, onMenuClick }: HeaderProps) {
    const { data: session } = useSession();
    const navigate = useNavigate();

    const name = session?.user.name ?? 'Admin';
    const email = session?.user.email ?? '';
    const initials =
        name
            .split(' ')
            .map((part) => part[0])
            .filter(Boolean)
            .slice(0, 2)
            .join('')
            .toUpperCase() || 'A';

    async function signOut() {
        try {
            const { error } = await authClient.signOut();
            if (error) {
                notifications.show({
                    color: 'red',
                    message: error.message || 'Could not sign out. Try again.',
                });
                return;
            }
            navigate('/login', { replace: true });
        } catch (error) {
            notifications.show({
                color: 'red',
                message: reportClientError(
                    error,
                    'admin sign out',
                    'Could not sign out. Try again.',
                ),
            });
        }
    }

    return (
        <Group
            h='100%'
            px={{ base: 'sm', sm: 'lg' }}
            justify='space-between'
            wrap='nowrap'
        >
            <Group gap='sm' wrap='nowrap'>
                <Burger
                    opened={opened}
                    onClick={onMenuClick}
                    hiddenFrom='md'
                    size='sm'
                    aria-label={opened ? 'Close navigation' : 'Open navigation'}
                    aria-expanded={opened}
                    aria-controls='admin-navigation'
                />
                <Text fw={700} size='md' style={{ whiteSpace: 'nowrap' }}>
                    Radii Admin
                </Text>
            </Group>

            <Menu shadow='md' width={220} position='bottom-end' withinPortal>
                <Menu.Target>
                    <UnstyledButton
                        className='admin-account-button'
                        aria-label='Admin account menu'
                    >
                        <Group gap='xs' wrap='nowrap'>
                            <Avatar color='blue' radius='xl' size='md'>
                                {initials}
                            </Avatar>
                            <Stack
                                gap={0}
                                visibleFrom='sm'
                                style={{ minWidth: 0 }}
                            >
                                <Text size='sm' fw={500} lineClamp={1}>
                                    {name}
                                </Text>
                                {email && (
                                    <Text size='xs' c='dimmed' lineClamp={1}>
                                        {email}
                                    </Text>
                                )}
                            </Stack>
                        </Group>
                    </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown>
                    <Menu.Label>Admin console</Menu.Label>
                    <Menu.Item
                        leftSection={<MdSettings size={16} />}
                        onClick={() => navigate('/settings')}
                    >
                        Settings
                    </Menu.Item>
                    <Menu.Item
                        color='red'
                        leftSection={<MdLogout size={16} />}
                        onClick={signOut}
                    >
                        Sign out
                    </Menu.Item>
                </Menu.Dropdown>
            </Menu>
        </Group>
    );
}
