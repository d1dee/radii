import { Button, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { useState, type ReactNode } from 'react';
import { MdExpandLess, MdExpandMore } from 'react-icons/md';

export function RecordFields({
    fields,
    columns = 1,
}: {
    fields: [string, string | null | undefined][];
    columns?: number;
}) {
    return (
        <SimpleGrid component='dl' m={0} cols={{ base: 1, sm: columns }} spacing='md'>
            {fields.map(([label, value]) => (
                <div key={label}>
                    <Text component='dt' size='xs' c='dimmed'>
                        {label}
                    </Text>
                    <Text
                        component='dd'
                        m={0}
                        size='sm'
                        style={{
                            overflowWrap: 'anywhere',
                            whiteSpace: 'pre-wrap',
                        }}
                    >
                        {value ?? 'Not recorded'}
                    </Text>
                </div>
            ))}
        </SimpleGrid>
    );
}

export function ExpandableTableRow({
    id,
    title,
    colSpan,
    children,
    details,
    actions,
    onToggle,
    expanded,
}: {
    id: string;
    title: string;
    colSpan: number;
    children: ReactNode;
    details: ReactNode;
    actions?: ReactNode;
    onToggle?: (opened: boolean) => void;
    expanded?: boolean;
}) {
    const [localOpened, setOpened] = useState(false);
    const opened = expanded ?? localOpened;
    function toggle() {
        setOpened(!opened);
        onToggle?.(!opened);
    }
    return (
        <>
            <Table.Tr
                className='statement-row'
                data-expanded={opened || undefined}
                onClick={toggle}
            >
                {children}
                <Table.Td>
                    <Button
                        size='xs'
                        variant='subtle'
                        aria-label={`${opened ? 'Hide' : 'View'} ${title.toLowerCase()}`}
                        aria-expanded={opened}
                        aria-controls={`${id}-details`}
                        rightSection={opened ? <MdExpandLess /> : <MdExpandMore />}
                        onClick={(event) => {
                            event.stopPropagation();
                            toggle();
                        }}
                    >
                        {opened ? 'Hide details' : 'View details'}
                    </Button>
                </Table.Td>
                {actions}
            </Table.Tr>
            {opened && (
                <Table.Tr className='statement-expanded-row'>
                    <Table.Td colSpan={colSpan}>
                        <Stack id={`${id}-details`} role='region' aria-label={title} p='md'>
                            {details}
                        </Stack>
                    </Table.Td>
                </Table.Tr>
            )}
        </>
    );
}
