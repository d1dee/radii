import {
    AppShell,
    Avatar,
    Burger,
    Group,
    Menu,
    NavLink,
    Overlay,
    Stack,
    Text,
    UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { ReactNode } from 'react';
import {
    MdAccountBalanceWallet,
    MdDescription,
    MdHistory,
    MdLogout,
    MdPayments,
    MdVerifiedUser,
    MdNotifications,
    MdSecurity,
    MdTrendingUp,
} from 'react-icons/md';

export const accountViews = [
    {
        value: 'statement',
        label: 'Earnings and statement',
        title: 'Commission account',
        description: 'Track your balances, earnings and withdrawal movements.',
        icon: MdAccountBalanceWallet,
    },
    {
        value: 'earnings',
        label: 'Earnings breakdown',
        title: 'Earnings breakdown',
        description:
            'Understand recorded commissions by month, source and rate.',
        icon: MdTrendingUp,
    },
    {
        value: 'agreements',
        label: 'Agreements',
        title: 'Commission agreements',
        description: 'Review commission rates, scope and effective dates.',
        icon: MdDescription,
    },
    {
        value: 'withdrawals',
        label: 'Withdrawals',
        title: 'Withdrawals',
        description:
            'Track withdrawal requests and payments recorded by your operator.',
        icon: MdPayments,
    },
    {
        value: 'audit',
        label: 'Account activity',
        title: 'Account activity',
        description: 'Review changes and activity on your commission account.',
        icon: MdHistory,
    },
    {
        value: 'payout',
        label: 'Payout destination',
        title: 'Payout destination',
        description: 'Manage where your operator sends withdrawal payments.',
        icon: MdVerifiedUser,
    },
    {
        value: 'notifications',
        label: 'Notifications',
        title: 'Notifications',
        description: 'Keep track of account and withdrawal updates.',
        icon: MdNotifications,
    },
    {
        value: 'security',
        label: 'Account security',
        title: 'Account security',
        description: 'Manage your password and signed-in sessions.',
        icon: MdSecurity,
    },
] as const;
export type AccountView = (typeof accountViews)[number]['value'];

export function PortalLayout({
    children,
    user,
    hasAccount,
    view,
    onView,
    onLogout,
    loggingOut,
}: {
    children: ReactNode;
    user?: { name: string; email: string };
    hasAccount: boolean;
    view: AccountView;
    onView: (view: AccountView) => void;
    onLogout: () => void;
    loggingOut: boolean;
}) {
    const [opened, { toggle, close }] = useDisclosure(false);
    const initials = user?.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('');
    return (
        <AppShell
            className='portal-shell'
            header={{ height: 60 }}
            navbar={{
                width: 250,
                breakpoint: 'md',
                collapsed: {
                    mobile: !hasAccount || !opened,
                    desktop: !hasAccount,
                },
            }}
            padding={{ base: 'sm', sm: 'lg', xl: 'xl' }}
            onKeyDown={(event) => {
                if (event.key === 'Escape') close();
            }}
        >
            <a className='portal-skip-link' href='#portal-content'>
                Skip to content
            </a>
            <AppShell.Header>
                <Group
                    h='100%'
                    px={{ base: 'sm', sm: 'lg' }}
                    justify='space-between'
                    wrap='nowrap'
                >
                    <Group gap='sm' wrap='nowrap'>
                        {hasAccount && (
                            <Burger
                                hiddenFrom='md'
                                size='sm'
                                opened={opened}
                                onClick={toggle}
                                aria-label={
                                    opened
                                        ? 'Close navigation'
                                        : 'Open navigation'
                                }
                                aria-expanded={opened}
                                aria-controls='portal-navigation'
                            />
                        )}
                        <Text
                            component='a'
                            href='/'
                            fw={700}
                            size='md'
                            className='portal-brand'
                        >
                            Radii Agents
                        </Text>
                    </Group>
                    {user && (
                        <Menu
                            shadow='md'
                            width={240}
                            position='bottom-end'
                            withinPortal
                        >
                            <Menu.Target>
                                <UnstyledButton
                                    className='portal-account-button'
                                    aria-label='Agent account menu'
                                >
                                    <Group gap='xs' wrap='nowrap'>
                                        <Avatar
                                            color='blue'
                                            radius='xl'
                                            size='md'
                                        >
                                            {initials}
                                        </Avatar>
                                        <Stack
                                            gap={0}
                                            visibleFrom='sm'
                                            miw={0}
                                            maw={220}
                                        >
                                            <Text size='sm' fw={500} truncate>
                                                {user.name}
                                            </Text>
                                            <Text size='xs' c='dimmed' truncate>
                                                {user.email}
                                            </Text>
                                        </Stack>
                                    </Group>
                                </UnstyledButton>
                            </Menu.Target>
                            <Menu.Dropdown>
                                <Menu.Label
                                    style={{ overflowWrap: 'anywhere' }}
                                >
                                    {user.email}
                                </Menu.Label>
                                <Menu.Item
                                    component='a'
                                    href='/#security'
                                    leftSection={<MdSecurity size={16} />}
                                >
                                    Account security
                                </Menu.Item>
                                <Menu.Item
                                    color='red'
                                    leftSection={<MdLogout size={16} />}
                                    disabled={loggingOut}
                                    onClick={onLogout}
                                >
                                    {loggingOut ? 'Signing out...' : 'Sign out'}
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
                    )}
                </Group>
            </AppShell.Header>
            {hasAccount && (
                <>
                    {opened && (
                        <Overlay
                            hiddenFrom='md'
                            fixed
                            zIndex={99}
                            backgroundOpacity={0.25}
                            onClick={close}
                            aria-hidden
                        />
                    )}
                    <AppShell.Navbar
                        id='portal-navigation'
                        w={250}
                        style={{ overflowY: 'auto' }}
                    >
                        <Stack
                            component='nav'
                            aria-label='Agent accounting views'
                            p='sm'
                            gap={4}
                        >
                            {accountViews.map((item) => (
                                <NavLink
                                    key={item.value}
                                    component='a'
                                    href={`#${item.value}`}
                                    label={item.label}
                                    leftSection={<item.icon size={20} />}
                                    active={view === item.value}
                                    aria-current={
                                        view === item.value ? 'page' : undefined
                                    }
                                    className='portal-nav-link'
                                    onClick={() => {
                                        onView(item.value);
                                        close();
                                    }}
                                />
                            ))}
                        </Stack>
                    </AppShell.Navbar>
                </>
            )}
            <AppShell.Main
                id='portal-content'
                tabIndex={-1}
                className={`portal-main${hasAccount ? ' portal-main-account' : ''}`}
            >
                {children}
            </AppShell.Main>
        </AppShell>
    );
}
