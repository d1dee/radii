import { AppShell, Overlay } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { Header } from './Header';
import { Sidebar } from './Sidebar';

interface AppLayoutProps {
    children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
    const [opened, { toggle, close }] = useDisclosure(false);

    return (
        <AppShell
            className='admin-shell'
            onKeyDown={(event) => {
                if (opened && event.key === 'Escape') close();
            }}
            header={{ height: 60 }}
            navbar={{
                width: 250,
                breakpoint: 'md',
                collapsed: { mobile: !opened },
            }}
            padding={{ base: 'sm', sm: 'lg', xl: 'xl' }}
        >
            <a className='admin-skip-link' href='#admin-content'>
                Skip to content
            </a>
            <AppShell.Header>
                <Header opened={opened} onMenuClick={toggle} />
            </AppShell.Header>
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
            <AppShell.Navbar id='admin-navigation' w={250}>
                <Sidebar onNavClick={close} />
            </AppShell.Navbar>
            <AppShell.Main
                id='admin-content'
                tabIndex={-1}
                className='admin-main'
                mih='100dvh'
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
