import {
    createContext,
    useCallback,
    useContext,
    useState,
    useSyncExternalStore,
    type Dispatch,
    type ReactNode,
    type SetStateAction,
} from 'react';

const TableStateContext = createContext<{
    values: Map<string, unknown>;
    listeners: Set<() => void>;
} | null>(null);

export function TableStateProvider({ children }: { children: ReactNode }) {
    const [store] = useState(() => ({
        values: new Map<string, unknown>(),
        listeners: new Set<() => void>(),
    }));

    return (
        <TableStateContext.Provider value={store}>
            {children}
        </TableStateContext.Provider>
    );
}

// Keep filters (including Dates) across route unmounts within one navigation branch.
export function useRememberedState<T>(
    key: string,
    initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
    const store = useContext(TableStateContext);
    if (!store) {
        throw new Error('useRememberedState requires TableStateProvider');
    }

    if (!store.values.has(key)) {
        store.values.set(
            key,
            typeof initial === 'function' ? (initial as () => T)() : initial,
        );
    }

    const subscribe = useCallback(
        (listener: () => void) => {
            store.listeners.add(listener);
            return () => {
                store.listeners.delete(listener);
            };
        },
        [store],
    );
    const getSnapshot = useCallback(
        () => store.values.get(key) as T,
        [store, key],
    );
    const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const setValue = useCallback<Dispatch<SetStateAction<T>>>(
        (action) => {
            const previous = store.values.get(key) as T;
            const next = typeof action === 'function'
                ? (action as (value: T) => T)(previous)
                : action;
            if (Object.is(previous, next)) return;
            store.values.set(key, next);
            store.listeners.forEach((listener) => listener());
        },
        [store, key],
    );

    return [value, setValue];
}
