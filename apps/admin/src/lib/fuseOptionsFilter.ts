import type { ComboboxItem, OptionsFilter } from '@mantine/core';
import Fuse from 'fuse.js';

export const fuseOptionsFilter: OptionsFilter = ({
    options,
    search,
    limit,
}) => {
    const items = options as ComboboxItem[];
    const query = search.trim();

    if (!query) return items.slice(0, limit);

    return new Fuse(items, {
        keys: ['label'],
        threshold: 0.3,
        ignoreLocation: true,
    })
        .search(query, { limit })
        .map(({ item }) => item);
};
