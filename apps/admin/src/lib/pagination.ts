import { TABLE_PAGE_SIZES, type PageSize } from '@shared/index';
import { useEffect, useRef, useState } from 'react';

export type { PageSize } from '@shared/index';

export const PAGE_SIZE_OPTIONS = [
    ...TABLE_PAGE_SIZES.map((value) => ({
        value: String(value),
        label: String(value),
    })),
    { value: 'all', label: 'All' },
];

export function pageSizeFromSelect(value: string | null): PageSize {
    return value === 'all' ? 'all' : Number(value ?? 10);
}

export function tableRowNumber(page: number, perPage: PageSize, index: number) {
    return (perPage === 'all' ? 0 : (page - 1) * perPage) + index + 1;
}

export function useTablePageSize(defaultSize: number, ready = true) {
    const [pageSize, setPageSize] = useState<PageSize>(defaultSize);
    const initialized = useRef(ready);

    useEffect(() => {
        if (!ready || initialized.current) return;
        initialized.current = true;
        setPageSize(defaultSize);
    }, [defaultSize, ready]);

    return [pageSize, setPageSize] as const;
}
