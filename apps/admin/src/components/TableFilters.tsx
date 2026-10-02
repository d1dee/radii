import { Box, Button, Group } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useId, type ReactNode } from 'react';
import { MdFilterList } from 'react-icons/md';

export function TableFilters({
    search,
    children,
}: {
    search: ReactNode;
    children: ReactNode;
}) {
    const [opened, { toggle }] = useDisclosure(false);
    const filtersId = useId();

    return (
        <Group gap='sm' wrap='wrap'>
            <Box className='admin-filter-search'>{search}</Box>
            <Button
                hiddenFrom='sm'
                variant='default'
                leftSection={<MdFilterList size={16} aria-hidden />}
                onClick={toggle}
                aria-expanded={opened}
                aria-controls={filtersId}
            >
                Filters
            </Button>
            <Group
                id={filtersId}
                className='admin-filter-options'
                data-open={opened || undefined}
                role='group'
                aria-label='Additional filters'
                gap='sm'
            >
                {children}
            </Group>
        </Group>
    );
}
