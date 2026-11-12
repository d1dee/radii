import {
    Box,
    Group,
    Pagination,
    Select,
    Stack,
    Table,
    Text,
} from '@mantine/core';
import { TABLE_PAGE_SIZES } from '@radii/shared';
import type { ReactNode } from 'react';
import { PageTableScrollContainer } from './components/PageTableScrollContainer';

export function LedgerTable({
    label,
    headers,
    total,
    page,
    perPage,
    onPage,
    onSize,
    children,
}: {
    label: string;
    headers: string[];
    total: number;
    page: number;
    perPage: number;
    onPage: (page: number) => void;
    onSize: (size: number) => void;
    children: ReactNode;
}) {
    return (
        <Stack gap='sm' miw={0}>
            {!total ? (
                <Text c='dimmed' py='lg'>
                    No {label.toLowerCase()} to show.
                </Text>
            ) : (
                <PageTableScrollContainer
                    minWidth={0}
                    w='100%'
                    role='region'
                    aria-label={label}
                    tabIndex={0}
                >
                    <Table stickyHeader highlightOnHover withRowBorders>
                        <Table.Thead>
                            <Table.Tr>
                                {headers.map((header) => (
                                    <Table.Th key={header}>{header}</Table.Th>
                                ))}
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>{children}</Table.Tbody>
                    </Table>
                </PageTableScrollContainer>
            )}
            {total > 0 && (
                <Group
                    align='center'
                    wrap='wrap'
                    gap='xs'
                    mt='auto'
                    className='ledger-footer'
                >
                    <Text
                        size='sm'
                        c='dimmed'
                        mr='auto'
                        style={{ flexShrink: 0 }}
                    >
                        {((page - 1) * perPage + 1).toLocaleString()}-
                        {Math.min(page * perPage, total).toLocaleString()} of{' '}
                        {total.toLocaleString()}
                    </Text>
                    <Group className='ledger-controls' gap='xs'>
                        <Select
                            pb='xs'
                            aria-label={`${label} rows per page`}
                            w={76}
                            size='xs'
                            comboboxProps={{ width: 88 }}
                            data={TABLE_PAGE_SIZES.map(String)}
                            value={String(perPage)}
                            allowDeselect={false}
                            onChange={(value) => onSize(Number(value))}
                        />
                        {total > perPage && (
                            <Box className='ledger-pagination-scroll'>
                                <Pagination
                                    size='sm'
                                    total={Math.max(
                                        1,
                                        Math.ceil(total / perPage),
                                    )}
                                    value={page}
                                    onChange={onPage}
                                    withEdges
                                    boundaries={1}
                                    siblings={1}
                                    gap={4}
                                    aria-label={`${label} pages`}
                                    getControlProps={(control) => ({
                                        'aria-label': `${control[0].toUpperCase()}${control.slice(1)} page`,
                                    })}
                                    getItemProps={(item) => ({
                                        'aria-label': `Page ${item}`,
                                        'aria-current':
                                            item === page ? 'page' : undefined,
                                    })}
                                />
                            </Box>
                        )}
                    </Group>
                </Group>
            )}
        </Stack>
    );
}
