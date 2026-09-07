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
            padding={{ base: 'md', xl: 'xl' }}
        >
            <AppShell.Header>
                <Header onMenuClick={() => setOpened((prev) => !prev)} />
            </AppShell.Header>
            <AppShell.Navbar>
                <Sidebar onNavClick={() => setOpened(false)} />
            </AppShell.Navbar>
            <AppShell.Main
                h='100dvh'
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    overflowY: 'auto',
                }}
            >
                {children}
            </AppShell.Main>
        </AppShell>
    );
}
