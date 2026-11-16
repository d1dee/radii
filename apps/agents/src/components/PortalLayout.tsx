import {
    Avatar,
    Burger,
    Group,
    Menu,
    Text,
    UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { ReactNode } from 'react';
import {
    MdArrowOutward,
    MdDashboard,
    MdDescription,
    MdLogout,
    MdReceiptLong,
    MdSecurity,
} from 'react-icons/md';

export const accountViews = [
    {
        value: 'overview',
        label: 'Overview',
        title: 'Your account at a glance',
        description:
            'Earnings, withdrawals and the details that keep you moving.',
        icon: MdDashboard,
    },
    {
        value: 'statement',
        label: 'Statements',
        title: 'Account statements',
        description:
            'Earnings and withdrawal movements, together in one traceable record.',
        icon: MdReceiptLong,
    },
    {
        value: 'agreements',
        label: 'Agreements',
        title: 'Commission agreements',
        description:
            'Your rates, when they apply and when another agreement takes precedence.',
        icon: MdDescription,
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
    const links = accountViews.filter((item) => item.value !== 'security');
    return (
        <div
            className='portal-shell'
            onKeyDown={(event) => {
                if (event.key === 'Escape') close();
            }}
        >
            <a
                className='portal-skip-link'
                href='#portal-content'
                onClick={(event) => {
                    event.preventDefault();
                    document.getElementById('portal-content')?.focus();
                }}
            >
                Skip to content
            </a>
            <header className='portal-topbar'>
                <Group gap='xl' wrap='nowrap' className='portal-topbar-left'>
                    <Text component='a' href='/' className='portal-brand'>
                        <span className='portal-brand-mark' aria-hidden>
                            <MdArrowOutward size={22} />
                        </span>
                        radii
                        <span className='portal-brand-caption'> / agents</span>
                    </Text>
                    {hasAccount && (
                        <nav
                            id='portal-navigation'
                            className={`portal-navigation${opened ? ' is-open' : ''}`}
                            aria-label='Agent accounting views'
                        >
                            {links.map((item) => (
                                <a
                                    key={item.value}
                                    href={`#${item.value}`}
                                    className={`portal-nav-link${view === item.value ? ' is-active' : ''}`}
                                    aria-current={
                                        view === item.value ? 'page' : undefined
                                    }
                                    onClick={() => {
                                        onView(item.value);
                                        close();
                                    }}
                                >
                                    <item.icon size={16} />
                                    {item.label}
                                </a>
                            ))}
                        </nav>
                    )}
                </Group>
                <Group gap='sm' wrap='nowrap'>
                    {hasAccount && (
                        <Burger
                            className='portal-mobile-toggle'
                            size='sm'
                            opened={opened}
                            onClick={toggle}
                            aria-label={
                                opened ? 'Close navigation' : 'Open navigation'
                            }
                            aria-expanded={opened}
                            aria-controls='portal-navigation'
                        />
                    )}
                    {user && (
                        <Menu
                            shadow='md'
                            width={250}
                            position='bottom-end'
                            withinPortal
                        >
                            <Menu.Target>
                                <UnstyledButton
                                    className='portal-account-button'
                                    aria-label='Agent account menu'
                                >
                                    <Avatar
                                        color='blue'
                                        radius='xl'
                                        size={36}
                                    >
                                        {initials}
                                    </Avatar>
                                </UnstyledButton>
                            </Menu.Target>
                            <Menu.Dropdown>
                                <Menu.Label
                                    style={{ overflowWrap: 'anywhere' }}
                                >
                                    {user.name}
                                    <br />
                                    {user.email}
                                </Menu.Label>
                                <Menu.Item
                                    component='a'
                                    href='/#security'
                                    leftSection={<MdSecurity size={16} />}
                                    onClick={close}
                                >
                                    Account security
                                </Menu.Item>
                                <Menu.Divider />
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
            </header>
            <main
                id='portal-content'
                tabIndex={-1}
                className={`portal-main${hasAccount ? ' portal-main-account' : ''}`}
            >
                {children}
            </main>
        </div>
    );
}
