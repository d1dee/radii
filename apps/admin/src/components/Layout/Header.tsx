import {
    ActionIcon,
    Avatar,
    Group,
    Menu,
    Stack,
    Text,
    UnstyledButton,
} from '@mantine/core'
import { MdLogout, MdMenu, MdSettings } from 'react-icons/md'
import { useNavigate } from 'react-router-dom'

import { authClient, useSession } from '@/lib/auth'

interface HeaderProps {
    onMenuClick: () => void
}

export function Header({ onMenuClick }: HeaderProps) {
    const { data: session } = useSession()
    const navigate = useNavigate()

    const name = session?.user.name ?? 'Admin'
    const email = session?.user.email ?? ''
    const initials =
        name
            .split(' ')
            .map((part) => part[0])
            .filter(Boolean)
            .slice(0, 2)
            .join('')
            .toUpperCase() || 'A'

    async function signOut() {
        await authClient.signOut()
        navigate('/login', { replace: true })
    }

    return (
        <Group h='100%' px='md' justify='space-between'>
            <Group>
                <ActionIcon variant='subtle' onClick={onMenuClick} hiddenFrom='md'>
                    <MdMenu size={20} />
                </ActionIcon>
                <Text fw={700} size='lg'>
                    Radii Admin
                </Text>
            </Group>

            <Menu shadow='md' width={220} position='bottom-end' withinPortal>
                <Menu.Target>
                    <UnstyledButton>
                        <Group gap='xs'>
                            <Avatar color='blue' radius='xl' size='md'>
                                {initials}
                            </Avatar>
                            <Stack gap={0} visibleFrom='sm'>
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
    )
}
