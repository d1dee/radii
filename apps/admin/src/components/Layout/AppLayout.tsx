import { AppShell } from '@mantine/core';
import { useState } from 'react';

import { Header } from './Header';
import { Sidebar } from './Sidebar';

interface AppLayoutProps {
    children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
    const [opened, setOpened] = useState(false);

    return (
        <AppShell
            header={{ height: 60 }}
            navbar={{
                width: 250,
                breakpoint: 'md',
                collapsed: { mobile: !opened },
            }}
            padding='md'
        >
            <AppShell.Header>
                <Header onMenuClick={() => setOpened((prev) => !prev)} />
            </AppShell.Header>
            <AppShell.Navbar>
                <Sidebar onNavClick={() => setOpened(false)} />
            </AppShell.Navbar>
            <AppShell.Main
                h='100%'
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {children}
            </AppShell.Main>
        </AppShell>
    );
}
