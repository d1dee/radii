import { Group, Pagination, Select, Text } from '@mantine/core';

import {
    PAGE_SIZE_OPTIONS,
    pageSizeFromSelect,
    type PageSize,
} from '@/lib/pagination';

export function TablePagination({
    page,
    perPage,
    total,
    onChange,
    onPerPageChange,
    rowsLabel = 'Rows per page',
    loading = false,
}: {
    page: number;
    perPage: PageSize;
    total: number;
    onChange: (page: number) => void;
    onPerPageChange: (perPage: PageSize) => void;
    rowsLabel?: string;
    loading?: boolean;
}) {
    const totalPages =
        perPage === 'all' ? 1 : Math.max(1, Math.ceil(total / perPage));

    const first =
        total === 0 ? 0 : perPage === 'all' ? 1 : (page - 1) * perPage + 1;
    const last = perPage === 'all' ? total : Math.min(page * perPage, total);
    const value = String(perPage);
    const options = PAGE_SIZE_OPTIONS.some((option) => option.value === value)
        ? PAGE_SIZE_OPTIONS
        : [{ value, label: value }, ...PAGE_SIZE_OPTIONS];

    return (
        <Group
            className='admin-table-pagination'
            align='center'
            wrap='wrap'
            gap='xs'
            mt='auto'
        >
            <Text size='sm' c='dimmed' mr='auto' style={{ flexShrink: 0 }}>
                {first.toLocaleString()}–{last.toLocaleString()} of{' '}
                {total.toLocaleString()}
            </Text>
            <Group gap='xs' wrap='nowrap' style={{ flexShrink: 0 }}>
                <Select
                    aria-label={rowsLabel}
                    value={value}
                    onChange={(next) =>
                        onPerPageChange(pageSizeFromSelect(next))
                    }
                    data={options}
                    allowDeselect={false}
                    disabled={loading}
                    size='xs'
                    w={76}
                    comboboxProps={{ width: 88 }}
                />
                {totalPages > 1 ? (
                    <Pagination
                        className='admin-pagination'
                        aria-label='Table pagination'
                        getControlProps={(control) => ({
                            'aria-label': `${control[0].toUpperCase()}${control.slice(1)} page`,
                        })}
                        getItemProps={(item) => ({
                            'aria-label': `Page ${item}`,
                            'aria-current': item === page ? 'page' : undefined,
                        })}
                        value={page}
                        onChange={onChange}
                        total={totalPages}
                        disabled={loading}
                        withEdges
                        siblings={1}
                        boundaries={1}
                        size='sm'
                        gap={4}
                    />
                ) : null}
            </Group>
        </Group>
    );
}
