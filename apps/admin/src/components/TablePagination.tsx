import { Group, Pagination, Text } from '@mantine/core';

export function TablePagination({
    page,
    perPage,
    total,
    onChange,
    loading = false,
}: {
    page: number;
    perPage: number;
    total: number;
    onChange: (page: number) => void;
    loading?: boolean;
}) {
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (totalPages <= 1) return null;

    const first = (page - 1) * perPage + 1;
    const last = Math.min(page * perPage, total);

    return (
        <Group justify='space-between' align='center' wrap='wrap' gap='xs'>
            <Text size='sm' c='dimmed' style={{ flexShrink: 0 }}>
                {first.toLocaleString()}–{last.toLocaleString()} of{' '}
                {total.toLocaleString()}
            </Text>
            <Pagination
                value={page}
                onChange={onChange}
                total={totalPages}
                disabled={loading}
                withEdges
                siblings={1}
                boundaries={1}
                size='sm'
                style={{ flexShrink: 0 }}
            />
        </Group>
    );
}
