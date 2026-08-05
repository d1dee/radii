import { useDisclosure } from '@mantine/hooks';
import {
    createContext,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { getClientData, getPackages, type Client } from '../lib/api.ts';
import type {
    MainPageProps,
    Package,
    Packages,
    Session,
} from '../types/index.ts';
import { PaymentFlow } from './Buy/PaymentFlow.tsx';
import { ConnectedDevicesModal } from './Packages/ConnectedDevicesModal.tsx';
import { CurrentPackage } from './Packages/CurrentPackage.tsx';
import { HavingIssues } from './Packages/HavingIssues.tsx';
import { PackagePricing } from './Packages/PackagePricing.tsx';
import { RegisterModal } from './RegisterForm/Modal.tsx';
import { UserAccount } from './UserAccounts/UserAccount.tsx';

export const SessionContext = createContext<Session | undefined>(null!);
export const ClientContext = createContext<Client | undefined>(null!);
export const PackagesContext = createContext<Array<[string, Array<Package>]>>(
    null!,
);

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

export default function Index({
    data,
    adminContacts,
}: {
    data: MainPageProps;
    adminContacts: { ADMIN_TEL: string; ADMIN_WHATSAPP: string };
}) {
    const [havingIssues, setHavingIssues] = useState(false);
    const [clientData, setClientData] = useState<Client | undefined>();
    const [packages, setPackages] = useState<Packages | undefined>();

    useEffect(() => {
        (async () => {
            const clientData = await getClientData();
            const packages = await getPackages();
            setClientData(clientData.data);
            setPackages(packages.data);
        })();
    });

    // Resume an interrupted purchase on first load (e.g. after a login
    // redirect). localStorage is synchronous, so the initial modal state can
    // be derived during render instead of via a setState-in-effect.
    const storedPackageId = localStorage.getItem('packageId');
    const resumeBuy = !!(data.session && storedPackageId);

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
        <ModalActionsContext.Provider value={modalActions}>
            <SessionContext.Provider value={data.session}>
                <ClientContext.Provider value={clientData}>
                    <UserAccount
                        havingIssues={[havingIssues, setHavingIssues]}
                    />

                    {havingIssues ? (
                        <HavingIssues adminContacts={adminContacts} />
                    ) : (
                        <CurrentPackage />
                    )}

                    {packages?.length ? (
                        <PackagesContext.Provider value={packages}>
                            <PackagePricing />
                        </PackagesContext.Provider>
                    ) : (
                        <>This gateway has not been onborded</>
                    )}

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
                </ClientContext.Provider>
            </SessionContext.Provider>
        </ModalActionsContext.Provider>
    );
}
