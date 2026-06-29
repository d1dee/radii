import { IconSearch } from '@tabler/icons-react';
import { Autocomplete, Burger, Divider, Drawer, Group, ScrollArea } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import classes from './AdminHeader.module.css';

const links = [
  { link: '/admin/dashboard', label: 'Dashboard' },
  { link: '/admin/packages', label: 'Packages' },
  { link: '/admin/users', label: 'Users' },
];

interface AdminHeaderProps {
  burgerOpened?: boolean;
  onBurgerClick?: () => void;
}

export function AdminHeader({ burgerOpened, onBurgerClick }: AdminHeaderProps) {
  const [drawerOpened, { toggle: toggleDrawer, close: closeDrawer }] = useDisclosure(false);

  const items = links.map((link) => (
    <a
      key={link.label}
      href={link.link}
      className={classes.link}
      onClick={(event) => event.preventDefault()}
    >
      {link.label}
    </a>
  ));

  return (
    <header className={classes.header}>
      <div className={classes.inner}>
        <Group>
          <Burger
            opened={burgerOpened ?? false}
            onClick={onBurgerClick ?? toggleDrawer}
            size="sm"
            hiddenFrom="sm"
            aria-label="Toggle navigation"
          />
          <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--mantine-color-blue-filled)' }}>
            Radii Admin
          </div>
        </Group>

        <Group>
          <Group ml={50} gap={5} className={classes.links} visibleFrom="sm">
            {items}
          </Group>
          <Autocomplete
            className={classes.search}
            placeholder="Search"
            leftSection={<IconSearch size={16} stroke={1.5} />}
            data={['Packages', 'Users', 'Settings', 'Analytics']}
            visibleFrom="xs"
          />
        </Group>
      </div>

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        size="100%"
        padding="md"
        title="Navigation"
        hiddenFrom="sm"
        zIndex={1000000}
      >
        <ScrollArea h="calc(100vh - 80px)" mx="-md">
          <Divider my="sm" />
          <Autocomplete
            placeholder="Search"
            leftSection={<IconSearch size={16} stroke={1.5} />}
            data={['Packages', 'Users', 'Settings', 'Analytics']}
            mx="md"
            mb="sm"
          />
          {items}
        </ScrollArea>
      </Drawer>
    </header>
  );
}
