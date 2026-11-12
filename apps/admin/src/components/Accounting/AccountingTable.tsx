import { Group, Pagination, Stack, Table, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { PageTableScrollContainer } from '@/components/PageTableScrollContainer';
import classes from './Accounting.module.css';
import { TablePagination } from '@/components/TablePagination';
import type { PageSize } from '@/lib/pagination';

export function AccountingRow({
    children,
    onOpen,
    label,
    selected = false,
}: {
    children: ReactNode;
    onOpen: () => void;
    label: string;
    selected?: boolean;
}) {
    return (
        <Table.Tr
            className={classes.row}
            tabIndex={0}
            aria-label={label}
            aria-selected={selected}
            onClick={(event) => {
                if (
                    (event.target as HTMLElement).closest(
                        'a, button, input, select, textarea',
                    )
                )
                    return;
                onOpen();
            }}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen();
                }
            }}
        >
            {children}
        </Table.Tr>
    );
}

export function AccountingTable({
    headers,
    children,
    total,
    page,
    onPage,
    empty,
    label,
    pageSize = 10,
    onPageSize,
}: {
    headers: string[];
    children: ReactNode;
    total: number;
    page: number;
    onPage: (page: number) => void;
    empty: string;
    label: string;
    pageSize?: PageSize;
    onPageSize?: (size: PageSize) => void;
}) {
    const perPage = pageSize === 'all' ? total : pageSize;
    return (
        <Stack gap='sm'>
            {total === 0 ? (
                <Text c='dimmed' py='lg'>
                    {empty}
                </Text>
            ) : (
                <>
                    <PageTableScrollContainer
                        minWidth={0}
                        aria-label={label}
                        w='100%'
                    >
                        <Table
                            stickyHeader
                            className={classes.table}
                            withRowBorders
                            highlightOnHover
                            style={{ width: '100%', minWidth: '100%' }}
                        >
                            <Table.Thead>
                                <Table.Tr>
                                    {headers.map((header) => (
                                        <Table.Th key={header}>
                                            {header}
                                        </Table.Th>
                                    ))}
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>{children}</Table.Tbody>
                        </Table>
                    </PageTableScrollContainer>
                    {onPageSize ? (
                        <TablePagination
                            page={page}
                            perPage={pageSize}
                            total={total}
                            onChange={onPage}
                            onPerPageChange={onPageSize}
                            rowsLabel={`${label} rows per page`}
                        />
                    ) : (
                        <Group justify='space-between' gap='sm'>
                            <Text size='xs' c='dimmed' role='status'>
                                {(page - 1) * perPage + 1}-
                                {Math.min(page * perPage, total)} of {total}{' '}
                                records
                            </Text>
                            <Pagination
                                size='sm'
                                total={
                                    pageSize === 'all'
                                        ? 1
                                        : Math.ceil(total / pageSize)
                                }
                                siblings={0}
                                value={page}
                                onChange={onPage}
                                aria-label={`${label} pages`}
                            />
                        </Group>
                    )}
                </>
            )}
        </Stack>
    );
}
