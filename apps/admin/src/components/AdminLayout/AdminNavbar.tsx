import { useState } from 'react';
import {
  IconGauge,
  IconHome2,
  IconLogout,
  IconPackages,
  IconSettings,
  IconUsers,
} from '@tabler/icons-react';
import { Center, Stack, Tooltip, UnstyledButton } from '@mantine/core';
import classes from './AdminNavbar.module.css';

interface NavbarLinkProps {
  icon: typeof IconHome2;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function NavbarLink({ icon: Icon, label, active, onClick }: NavbarLinkProps) {
  return (
    <Tooltip label={label} position="right" transitionProps={{ duration: 0 }}>
      <UnstyledButton
        onClick={onClick}
        className={classes.link}
        data-active={active || undefined}
        aria-label={label}
      >
        <Icon size={20} stroke={1.5} />
      </UnstyledButton>
    </Tooltip>
  );
}

const navItems = [
  { icon: IconHome2, label: 'Home' },
  { icon: IconGauge, label: 'Dashboard' },
  { icon: IconPackages, label: 'Packages' },
  { icon: IconUsers, label: 'Users' },
  { icon: IconSettings, label: 'Settings' },
];

interface AdminNavbarProps {
  onNavigate?: (label: string) => void;
  onLogout?: () => void;
}

export function AdminNavbar({ onNavigate, onLogout }: AdminNavbarProps) {
  const [active, setActive] = useState(1);

  const links = navItems.map((link, index) => (
    <NavbarLink
      {...link}
      key={link.label}
      active={index === active}
      onClick={() => {
        setActive(index);
        onNavigate?.(link.label);
      }}
    />
  ));

  return (
    <nav className={classes.navbar}>
      <Center>
        <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--mantine-color-blue-filled)' }}>
          R
        </div>
      </Center>

      <div className={classes.navbarMain}>
        <Stack justify="center" gap={0}>
          {links}
        </Stack>
      </div>

      <Stack justify="center" gap={0}>
        <NavbarLink icon={IconLogout} label="Logout" onClick={onLogout} />
      </Stack>
    </nav>
  );
}
