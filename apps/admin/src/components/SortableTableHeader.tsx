import { Group, Table, Text, UnstyledButton } from '@mantine/core';
import { MdArrowDownward, MdArrowUpward, MdUnfoldMore } from 'react-icons/md';

export type SortDirection = 'asc' | 'desc';

export function SortableTableHeader<SortKey extends string>({
    label,
    width,
    sortKey,
    sortBy,
    sortDirection,
    onSort,
    initialDirection = 'asc',
}: {
    label: string;
    width?: number;
    sortKey: SortKey;
    sortBy: SortKey | null;
    sortDirection: SortDirection;
    onSort: (sortBy: SortKey, sortDirection: SortDirection) => void;
    initialDirection?: SortDirection;
}) {
    const active = sortBy === sortKey;
    const nextDirection = active
        ? sortDirection === 'asc'
            ? 'desc'
            : 'asc'
        : initialDirection;
    const Icon = active
        ? sortDirection === 'asc'
            ? MdArrowUpward
            : MdArrowDownward
        : MdUnfoldMore;

    return (
        <Table.Th
            style={width ? { width, minWidth: width } : undefined}
            aria-sort={
                active
                    ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                    : 'none'
            }
        >
            <UnstyledButton
                type='button'
                onClick={() => onSort(sortKey, nextDirection)}
                aria-label={`Sort by ${label} ${nextDirection === 'asc' ? 'ascending' : 'descending'}`}
                style={{ width: '100%' }}
            >
                <Group gap={4} wrap='nowrap'>
                    <Text span size='sm' fw={600} inherit>
                        {label}
                    </Text>
                    <Icon
                        size={15}
                        aria-hidden
                        style={{
                            flexShrink: 0,
                            opacity: active ? 1 : 0.45,
                        }}
                    />
                </Group>
            </UnstyledButton>
        </Table.Th>
    );
}
