import { NavLink, ScrollArea, Stack } from '@mantine/core';
import { useLocation, Link } from 'react-router-dom';
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

interface SidebarProps {
    onNavClick?: () => void;
}

const links = [
    { to: '/', label: 'Dashboard', icon: MdDashboard },
    { to: '/users', label: 'Users', icon: MdPeople },
    { to: '/packages', label: 'Packages', icon: MdRouter },
    { to: '/sessions', label: 'Live Sessions', icon: MdWifiTethering },
    { to: '/payments', label: 'Payments', icon: MdReceiptLong },
    { to: '/nas-devices', label: 'NAS Devices', icon: MdStorage },
    { to: '/reports', label: 'Reports', icon: MdBarChart },
    { to: '/settings', label: 'Settings', icon: MdSettings },
];

export function Sidebar({ onNavClick }: SidebarProps) {
    const location = useLocation();

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
            </Stack>
        </ScrollArea>
    );
}
