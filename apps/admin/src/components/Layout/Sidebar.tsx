import { NavLink, ScrollArea, Stack } from '@mantine/core';
import { useEffect, useState } from 'react';
import {
    MdBarChart,
    MdDashboard,
    MdPeople,
    MdReceiptLong,
    MdRouter,
    MdSettings,
    MdStorage,
    MdWifiTethering,
} from 'react-icons/md';
import { Link, useLocation } from 'react-router-dom';

import { settingsCategories } from '@/lib/settingsCategories';

interface SidebarProps {
    onNavClick?: () => void;
}

const links = [
    { to: '/', label: 'Dashboard', icon: MdDashboard },
    { to: '/users', label: 'Users', icon: MdPeople },
    { to: '/packages', label: 'Packages', icon: MdRouter },
    { to: '/sessions', label: 'Sessions', icon: MdWifiTethering },
    { to: '/payments', label: 'Payments', icon: MdReceiptLong },
    { to: '/nas-devices', label: 'NAS Devices', icon: MdStorage },
    { to: '/reports', label: 'Reports', icon: MdBarChart },
];

export function Sidebar({ onNavClick }: SidebarProps) {
    const location = useLocation();
    const isSettingsPath =
        location.pathname === '/settings' ||
        location.pathname.startsWith('/settings/');
    const [settingsOpened, setSettingsOpened] = useState(isSettingsPath);

    useEffect(() => {
        if (isSettingsPath) setSettingsOpened(true);
    }, [location.pathname, isSettingsPath]);

    return (
        <ScrollArea h='100%' type='auto'>
            <Stack component='nav' aria-label='Main navigation' p='sm' gap={4}>
                {links.map((link) => (
                    <NavLink
                        key={link.to}
                        component={Link}
                        to={link.to}
                        label={link.label}
                        leftSection={<link.icon size={20} />}
                        active={
                            link.to === '/'
                                ? location.pathname === '/'
                                : location.pathname.startsWith(link.to)
                        }
                        aria-current={
                            (
                                link.to === '/'
                                    ? location.pathname === '/'
                                    : location.pathname.startsWith(link.to)
                            )
                                ? 'page'
                                : undefined
                        }
                        onClick={onNavClick}
                    />
                ))}
                <NavLink
                    component='button'
                    type='button'
                    label='Settings'
                    leftSection={<MdSettings size={20} />}
                    active={isSettingsPath}
                    opened={settingsOpened}
                    onChange={setSettingsOpened}
                    aria-expanded={settingsOpened}
                    childrenOffset={24}
                >
                    {settingsCategories.map((category) => {
                        const to = `/settings/${category.id}`;
                        const active = location.pathname === to;

                        return (
                            <NavLink
                                key={category.id}
                                component={Link}
                                to={to}
                                label={category.label}
                                leftSection={<category.icon size={18} />}
                                active={active}
                                aria-current={active ? 'page' : undefined}
                                onClick={onNavClick}
                            />
                        );
                    })}
                </NavLink>
            </Stack>
        </ScrollArea>
    );
}
