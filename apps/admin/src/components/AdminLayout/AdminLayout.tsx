import { AppShell } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useNavigate } from 'react-router-dom';
import { AdminHeader } from './AdminHeader';
import { AdminNavbar } from './AdminNavbar';
import { authClient } from '../../lib/auth-client';

interface AdminLayoutProps {
  children: React.ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await authClient.signOut();
    navigate('/login');
  };

  return (
    <AppShell
      padding="md"
      header={{ height: 56 }}
      navbar={{
        width: 80,
        breakpoint: 'sm',
        collapsed: { mobile: !mobileOpened },
      }}
      layout="alt"
    >
      <AppShell.Header>
        <AdminHeader
          burgerOpened={mobileOpened}
          onBurgerClick={toggleMobile}
        />
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <AdminNavbar onLogout={handleLogout} />
      </AppShell.Navbar>

      <AppShell.Main>
        <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          {children}
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
