import { ActionIcon, Avatar, Group, Text } from '@mantine/core'
import { MdMenu } from 'react-icons/md'

interface HeaderProps {
    onMenuClick: () => void
}

export function Header({ onMenuClick }: HeaderProps) {
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

            <Group gap='xs'>
                <Avatar color='blue' radius='xl' size='md'>
                    A
                </Avatar>
                <Text size='sm' visibleFrom='sm'>
                    Admin
                </Text>
            </Group>
        </Group>
    )
}
