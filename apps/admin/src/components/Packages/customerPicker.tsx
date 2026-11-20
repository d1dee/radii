import { MultiSelect, type OptionsFilter } from '@mantine/core';
import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from 'react';

import { getAdminCustomerOptions, type AdminCustomerOption } from '@/lib/api';

type CustomerOptions = {
    options: AdminCustomerOption[];
    loading: boolean;
    error: string | null;
};
const CustomerPreload = createContext<CustomerOptions | null>(null);
const remoteFilter: OptionsFilter = ({ options }) => options;

export function CustomerPickerProvider({ children }: { children: ReactNode }) {
    const [preload, setPreload] = useState<CustomerOptions>({
        options: [],
        loading: true,
        error: null,
    });
    useEffect(() => {
        let active = true;
        void getAdminCustomerOptions()
            .then((result) => {
                if (!active) return;
                setPreload(
                    result.success && result.data
                        ? { options: result.data, loading: false, error: null }
                        : {
                              options: [],
                              loading: false,
                              error: result.success
                                  ? 'Could not load customer suggestions.'
                                  : result.message,
                          },
                );
            })
            .catch(() => {
                if (active)
                    setPreload({
                        options: [],
                        loading: false,
                        error: 'Could not load customer suggestions. Type to search again.',
                    });
            });
        return () => {
            active = false;
        };
    }, []);
    return (
        <CustomerPreload.Provider value={preload}>
            {children}
        </CustomerPreload.Provider>
    );
}

export function useCustomerPicker(selectedIds: string[]) {
    const preload = useContext(CustomerPreload);
    if (!preload)
        throw new Error('Customer pickers require CustomerPickerProvider');
    const [searchValue, setSearchValue] = useState('');
    const [search, setSearch] = useState<CustomerOptions>({
        options: [],
        loading: false,
        error: null,
    });
    const [retained, setRetained] = useState<AdminCustomerOption[]>([]);
    const [hydrationError, setHydrationError] = useState<string | null>(null);
    const query = searchValue.trim();
    const selectedKey = JSON.stringify(selectedIds);
    const suggestions = query ? search.options : preload.options;

    useEffect(() => {
        if (!query) return;
        let active = true;
        setSearch({ options: [], loading: true, error: null });
        const timer = setTimeout(() => {
            void getAdminCustomerOptions({ q: query })
                .then((result) => {
                    if (!active) return;
                    setSearch(
                        result.success && result.data
                            ? {
                                  options: result.data,
                                  loading: false,
                                  error: null,
                              }
                            : {
                                  options: [],
                                  loading: false,
                                  error: result.success
                                      ? 'Could not search customers.'
                                      : result.message,
                              },
                    );
                })
                .catch(() => {
                    if (active)
                        setSearch({
                            options: [],
                            loading: false,
                            error: 'Could not search customers. Edit the search to try again.',
                        });
                });
        }, 300);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [query]);

    useEffect(() => {
        const ids = new Set<string>(JSON.parse(selectedKey));
        setRetained((current) => [
            ...new Map(
                [...current, ...preload.options, ...search.options]
                    .filter((option) => ids.has(option.value))
                    .map((option) => [option.value, option]),
            ).values(),
        ]);
    }, [selectedKey, preload.options, search.options]);

    useEffect(() => {
        const ids: string[] = JSON.parse(selectedKey);
        setHydrationError(null);
        if (!ids.length) return;
        let active = true;
        void getAdminCustomerOptions({ ids: ids.slice(0, 500) })
            .then((result) => {
                if (!active) return;
                if (result.success && result.data) {
                    setRetained((current) => [
                        ...new Map(
                            [...current, ...result.data!]
                                .filter((option) => ids.includes(option.value))
                                .map((option) => [option.value, option]),
                        ).values(),
                    ]);
                } else
                    setHydrationError(
                        result.success
                            ? 'Could not load selected customers.'
                            : result.message,
                    );
            })
            .catch(() => {
                if (active)
                    setHydrationError('Could not load selected customers.');
            });
        return () => {
            active = false;
        };
    }, [selectedKey]);

    const options = [
        ...new Map(
            [
                ...[...retained, ...preload.options, ...search.options].filter(
                    (option) => selectedIds.includes(option.value),
                ),
                ...suggestions,
            ].map((option) => [option.value, option]),
        ).values(),
    ];
    const data = [
        ...options,
        ...selectedIds
            .filter((id) => !options.some((option) => option.value === id))
            .map((id) => ({
                value: id,
                label: `Unavailable customer (${id})`,
                disabled: true,
            })),
    ];
    return {
        data,
        options,
        searchValue,
        setSearchValue,
        filter: remoteFilter,
        loading: query ? search.loading : preload.loading,
        error: (query ? search.error : preload.error) ?? hydrationError,
    };
}

export function CustomerMultiSelect({
    value,
    onChange,
}: {
    value: string[];
    onChange: (value: string[]) => void;
}) {
    const picker = useCustomerPicker(value);
    return (
        <MultiSelect
            pb='xs'
            label='Customer numbers'
            description='Search and select registered customers by name, location or phone number.'
            descriptionProps={{ pb: 'xs' }}
            placeholder='Search name, location or phone number'
            searchable
            clearable
            data={picker.data}
            value={value}
            maxValues={500}
            filter={picker.filter}
            searchValue={picker.searchValue}
            onSearchChange={picker.setSearchValue}
            loading={picker.loading}
            error={picker.error}
            nothingFoundMessage={
                picker.loading
                    ? 'Searching customers...'
                    : 'No registered customer matches this search'
            }
            onChange={onChange}
        />
    );
}
