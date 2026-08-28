import '@mantine/core/styles.css';

import { Container, MantineProvider, Stack } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { Package, Packages } from '@radii/shared';
import {
    createContext,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { PaymentFlow } from './components/Buy/PaymentFlow.tsx';
import { LOGIN_REQUEST_KEY } from './components/HotspotLoginRedirect.tsx';
import { ConnectedDevicesModal } from './components/Packages/ConnectedDevicesModal.tsx';
import { CurrentPackage } from './components/Packages/CurrentPackage.tsx';
import { HavingIssues } from './components/Packages/HavingIssues.tsx';
import { PackagePricing } from './components/Packages/PackagePricing.tsx';
import { RegisterModal } from './components/RegisterForm/Modal.tsx';
import { UserAccount } from './components/UserAccounts/UserAccount.tsx';
import { getClientData, getPackages, type Client } from './lib/api.ts';
import { authClient, useSession } from './lib/auth.ts';

// The NAS hotspot login page hands the client browser to the portal with a
// `login_request` id (see POST /api/hotspot/login-request). Persist the id
// so it survives the sign-in flow, then clean the URL.
const capturedLoginRequestId = new URLSearchParams(window.location.search).get(
    'login_request',
);

if (capturedLoginRequestId) {
    localStorage.setItem(LOGIN_REQUEST_KEY, capturedLoginRequestId);
    const cleaned = new URLSearchParams(window.location.search);
    cleaned.delete('login_request');
    const query = cleaned.toString();
    window.history.replaceState(
        null,
        '',
        query
            ? `${window.location.pathname}?${query}`
            : window.location.pathname,
    );
}

export const ClientContext = createContext<Client | undefined>(null!);

export type ModalActions = {
    /** Open the buy/payment flow for a package */
    startBuy: (pkg: { packageId: string; price: string }) => void;
    /** Open the register modal, optionally seeding a packageId */
    openRegister: (packageId?: string, price?: string) => void;
    /** Open the login modal, optionally seeding a packageId */
    openLogin: (packageId?: string, price?: string) => void;
    /** Open the connected-devices modal with a snapshot of current quotas */
    openConnectedDevices: () => void;
};

export const ModalActionsContext = createContext<ModalActions>(null!);

function pkgPrice(
    dbPackages: Array<[string, Array<Package>]> | undefined,
    packageId: string,
) {
    return String(
        dbPackages
            ?.flat(2)
            .find(
                (v): v is Package =>
                    typeof v !== 'string' && v?.packageId === packageId,
            )?.price || '',
    );
}

export default function App() {
    const [havingIssues, setHavingIssues] = useState(false);
    const [clientData, setClientData] = useState<Client | undefined>();
    const [packages, setPackages] = useState<Packages | undefined>();

    const adminContacts = { ADMIN_TEL: '', ADMIN_WHATSAPP: '' };

    const { data } = useSession();

    useEffect(() => {
        (async () => {
            const clientData = await getClientData();
            if (clientData.success) setClientData(clientData.data);
            const loginRequestId = localStorage.getItem(LOGIN_REQUEST_KEY);
            if (!loginRequestId) return;
            const packages = await getPackages(loginRequestId);
            if (packages.success) setPackages(packages.data);
        })();
    }, [data]);

    const session = authClient.useSession();

    // Resume an interrupted purchase on first load (e.g. after a login
    // redirect). localStorage is synchronous, so the initial modal state can
    // be derived during render instead of via a setState-in-effect.
    const storedPackageId = localStorage.getItem('packageId');
    const resumeBuy = !!(session && storedPackageId);

    // ---- Decoupled modal state (each modal owns its own disclosure) ----
    const [buyOpened, { open: openBuy, close: closeBuy }] =
        useDisclosure(resumeBuy);
    const [buySeed, setBuySeed] = useState<{
        packageId: string;
        price: string;
    } | null>(
        resumeBuy && storedPackageId
            ? {
                  packageId: storedPackageId,
                  price: pkgPrice(packages, storedPackageId),
              }
            : null,
    );
    // Bumped on each open so PaymentFlow remounts with fresh state.
    const [buyKey, setBuyKey] = useState(resumeBuy ? 1 : 0);

    const [authOpened, { open: openAuth, close: closeAuth }] =
        useDisclosure(false);
    const [authMode, setAuthMode] = useState<'register' | 'login'>('register');
    const [authPackageId, setAuthPackageId] = useState('');
    const [authPrice, setAuthPrice] = useState('');

    const [connectedOpened, { open: openConnected, close: closeConnected }] =
        useDisclosure(false);

    const startBuy = useCallback(
        (pkg: { packageId: string; price: string }) => {
            setBuySeed(pkg);
            setBuyKey((k) => k + 1);
            openBuy();
        },
        [openBuy],
    );
    const openRegister = useCallback(
        (packageId = '', price = '') => {
            setAuthPackageId(packageId);
            setAuthPrice(price);
            setAuthMode('register');
            openAuth();
        },
        [openAuth],
    );
    const openLogin = useCallback(
        (packageId = '', price = '') => {
            setAuthPackageId(packageId);
            setAuthPrice(price);
            setAuthMode('login');
            openAuth();
        },
        [openAuth],
    );
    const openConnectedDevices = useCallback(() => {
        openConnected();
    }, [openConnected]);

    const modalActions = useMemo<ModalActions>(
        () => ({ startBuy, openRegister, openLogin, openConnectedDevices }),
        [startBuy, openRegister, openLogin, openConnectedDevices],
    );

    // The stored package id has now been seeded into the buy flow; remove it.
    useEffect(() => {
        if (storedPackageId) localStorage.removeItem('packageId');
    }, [storedPackageId]);

    return (
        <MantineProvider defaultColorScheme='auto'>
            <Container size='sm' p='md'>
                <ModalActionsContext.Provider value={modalActions}>
                    <ClientContext.Provider value={clientData}>
                        <Stack gap='md'>
                            <UserAccount
                                havingIssues={[havingIssues, setHavingIssues]}
                            />
                            {havingIssues ? (
                                <HavingIssues adminContacts={adminContacts} />
                            ) : (
                                <CurrentPackage />
                            )}
                            <PackagePricing packages={packages} />
                            {/*
                      Modals are rendered outside the mutating QuotaContext and
                      own their state locally, so background polling cannot
                      mutate data shown inside them.
                    */}
                            <PaymentFlow
                                key={buyKey}
                                opened={buyOpened}
                                onClose={closeBuy}
                                seed={buySeed}
                            />
                            <RegisterModal
                                opened={authOpened}
                                onClose={closeAuth}
                                mode={authMode}
                                onModeChange={setAuthMode}
                                packageId={authPackageId}
                                price={authPrice}
                            />
                            <ConnectedDevicesModal
                                opened={connectedOpened}
                                onClose={closeConnected}
                            />
                        </Stack>
                    </ClientContext.Provider>
                </ModalActionsContext.Provider>
            </Container>
        </MantineProvider>
    );
}
