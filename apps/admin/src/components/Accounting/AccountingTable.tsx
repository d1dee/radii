import { Center, Pagination, Stack, Table, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { PageTableScrollContainer } from '@/components/PageTableScrollContainer';

export function AccountingTable({
    headers,
    children,
    total,
    page,
    onPage,
    empty,
    label,
}: {
    headers: string[];
    children: ReactNode;
    total: number;
    page: number;
    onPage: (page: number) => void;
    empty: string;
    label: string;
}) {
    return (
        <Stack gap='sm'>
            {total === 0 ? (
                <Text c='dimmed' py='lg'>
                    {empty}
                </Text>
            ) : (
                <>
                    <PageTableScrollContainer minWidth={0} aria-label={label}>
                        <Table
                            withRowBorders
                            highlightOnHover
                            style={{ width: 'max-content', minWidth: 0 }}
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
                    <Center>
                        <Pagination
                            size='sm'
                            total={Math.ceil(total / 10)}
                            value={page}
                            onChange={onPage}
                            aria-label={`${label} pages`}
                        />
                    </Center>
                    <Text size='xs' c='dimmed'>
                        {total} records
                    </Text>
                </>
            )}
        </Stack>
    );
}
