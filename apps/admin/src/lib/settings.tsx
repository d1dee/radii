// Per-admin settings context. Loads the signed-in admin's settings once the
// console mounts, exposes them to pages (dashboard cadence, table sizes) and
// applies the appearance section (time/date format, timezone, currency label)
// to the shared formatting helpers in lib/format.ts.

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from 'react';
import {
    ApiErrorType,
    defaultAdminSettings,
    type AdminSettings,
    type AdminSettingsInput,
    type ApiEnvelope,
} from '@shared/index';

import { getAdminSettings, updateAdminSettings } from '@/lib/api';
import { warnBackgroundFailure } from '@/lib/clientError';
import { configureAppearance } from '@/lib/format';

interface SettingsContextValue {
    settings: AdminSettings;
    // True once the settings finished loading from the server (successfully or
    // not); pages gate their first data fetch on this so defaults apply.
    loaded: boolean;
    saveSettings: (
        input: AdminSettingsInput,
    ) => Promise<ApiEnvelope<AdminSettings>>;
}

const SettingsContext = createContext<SettingsContextValue>({
    settings: defaultAdminSettings,
    loaded: false,
    saveSettings: async () => ({
        success: false,
        message: 'Settings are not available yet.',
        type: ApiErrorType.INTERNAL_ERROR,
    }),
});

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<AdminSettings>(
        defaultAdminSettings,
    );
    const [loaded, setLoaded] = useState(false);

    const apply = useCallback((next: AdminSettings) => {
        setSettings(next);
        configureAppearance(next.appearance);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await getAdminSettings();
            if (cancelled) return;
            if (res.success && res.data) apply(res.data);
            else warnBackgroundFailure('load admin settings', res);
            setLoaded(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [apply]);

    const saveSettings = useCallback(
        async (input: AdminSettingsInput) => {
            const res = await updateAdminSettings(input);
            if (res.success && res.data) apply(res.data);
            return res;
        },
        [apply],
    );

    return (
        <SettingsContext.Provider value={{ settings, loaded, saveSettings }}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useAdminSettings(): SettingsContextValue {
    return useContext(SettingsContext);
}
