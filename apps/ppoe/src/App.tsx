import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@radii/ui/fonts.css';

import { Alert, Container, MantineProvider, Stack } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Notifications } from '@mantine/notifications';
import type { Package } from '@radii/shared';
import { typography } from '@radii/ui';
import {
    createContext,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { AiOutlineExclamationCircle } from 'react-icons/ai';
import { PaymentFlow } from './components/Buy/PaymentFlow.tsx';
import { PppoeAccountCard } from './components/Credentials/PppoeAccountCard.tsx';
import { Footer } from './components/Footer.tsx';
import { CurrentPackage } from './components/Packages/CurrentPackage.tsx';
import { HavingIssues } from './components/Packages/HavingIssues.tsx';
import { PackagePricing } from './components/Packages/PackagePricing.tsx';
import {
    RegisterModal,
    type AuthMode,
} from './components/RegisterForm/Modal.tsx';
import { LoginCard } from './components/UserAccounts/LoginCard.tsx';
import { UserAccount } from './components/UserAccounts/UserAccount.tsx';
import { type Client } from './lib/api.ts';
import { useSession } from './lib/auth.ts';
import {
    loadPppoePortal,
    refreshPppoeAccounts,
    useNasScope,
    usePppoeAccounts,
    usePppoePortal,
} from './lib/store.ts';

// Operators may link the portal to one NAS with ?nas=<nasDeviceId>;
// lib/api.ts persists the id so package listings stay scoped. Clean the URL.
if (new URLSearchParams(window.location.search).has('nas')) {
    const cleaned = new URLSearchParams(window.location.search);
    cleaned.delete('nas');
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
    /** Open the login modal in reset-PIN mode */
    openForgotPin: () => void;
};

export const ModalActionsContext = createContext<ModalActions>(null!);

function pkgPrice(
    dbPackages: Array<[string, Array<Package>]> | undefined,
    packageId: string,
) {
    const pkg = dbPackages
        ?.flatMap(([, offers]) => offers)
        .find((offer) => offer.packageId === packageId);
    return pkg ? String(pkg.price + (pkg.connectionFee ?? 0)) : '';
}

export default function App() {
    const [havingIssues, setHavingIssues] = useState(false);
    const { data, isPending } = useSession();
    const userId = data?.user?.id ?? null;
    // The session is only known once the pending check has settled.
    const signedOut = !isPending && !data?.session;
    const { nasDeviceId } = useNasScope();
    const {
        client: clientData,
        packages,
        packagesError,
        packagesLoading,
        contacts: adminContacts,
    } = usePppoePortal({
        userId,
        nasDeviceId,
        pending: isPending,
    });
    const { clients, selectedAccountId, loading: accountsLoading } =
        usePppoeAccounts();
    // Purchases land on the account the portal is currently showing (the
    // account switcher selection also sets the NAS scope). If that account is
    // not on the scoped network, pass null so the backend provisions one on
    // the scoped NAS instead of misattributing the payment.
    const purchaseAccountId =
        clients.find(
            (client) =>
                client.accountId === selectedAccountId &&
                client.availableOnPortal,
        )?.accountId ?? null;

    useEffect(() => {
        if (!isPending) {
            void loadPppoePortal(userId, nasDeviceId);
        }
    }, [userId, isPending, nasDeviceId]);

    // Accounts must load even without a network scope: they drive the
    // auto-scoping of external visits (the account switcher adopts the
    // network of the default account) and refresh availability on every
    // scope change.
    useEffect(() => {
        if (!isPending && data?.session) void refreshPppoeAccounts();
    }, [data?.session, isPending, nasDeviceId]);

    // Resume an interrupted purchase on first load (e.g. after a login
    // redirect). localStorage is synchronous, so the initial modal state can
    // be derived during render instead of via a setState-in-effect.
    const storedPackageId = localStorage.getItem('packageId');
    const resumeBuy = Boolean(storedPackageId);

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
    // Follow scoped offer updates without unmounting checkout during background
    // refreshes. The server validates expectedAmount against the payable total.
    const checkoutLoading = isPending || packagesLoading || accountsLoading;
    const checkoutPrice = buySeed ? pkgPrice(packages, buySeed.packageId) : '';
    const checkoutSeed =
        data?.session &&
        !checkoutLoading &&
        checkoutPrice !== '' &&
        buySeed
            ? { packageId: buySeed.packageId, price: checkoutPrice }
            : null;

    const [authOpened, { open: openAuth, close: closeAuth }] =
        useDisclosure(false);
    const [authMode, setAuthMode] = useState<AuthMode>('register');
    const [authPackageId, setAuthPackageId] = useState('');
    const [authPrice, setAuthPrice] = useState('');

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
    const openForgotPin = useCallback(() => {
        setAuthPackageId('');
        setAuthPrice('');
        setAuthMode('reset');
        openAuth();
    }, [openAuth]);

    const modalActions = useMemo<ModalActions>(
        () => ({ startBuy, openRegister, openLogin, openForgotPin }),
        [startBuy, openRegister, openLogin, openForgotPin],
    );

    // The stored package id has now been seeded into the buy flow; remove it.
    useEffect(() => {
        if (storedPackageId) localStorage.removeItem('packageId');
    }, [storedPackageId]);

    return (
        <MantineProvider theme={typography} defaultColorScheme='auto'>
            <Notifications position='top-center' />
            <Container
                size='sm'
                py='md'
                mih='100dvh'
                style={{ display: 'flex', flexDirection: 'column' }}
            >
                <ModalActionsContext.Provider value={modalActions}>
                    <ClientContext.Provider value={clientData}>
                        <Stack justify='space-between' style={{ flex: 1 }}>
                            <Stack gap='md'>
                                <UserAccount
                                    havingIssues={[
                                        havingIssues,
                                        setHavingIssues,
                                    ]}
                                />
                                {signedOut && !nasDeviceId ? (
                                    // Without a scoped network there is
                                    // nothing to show yet: signing in lets
                                    // the portal resolve the network from the
                                    // customer's own accounts.
                                    <>
                                        <Alert
                                            color='orange'
                                            title='Network not identified'
                                            icon={
                                                <AiOutlineExclamationCircle
                                                    size={24}
                                                />
                                            }
                                        >
                                            We could not identify the network
                                            you are visiting from. Sign in to
                                            see the packages available for your
                                            network.
                                        </Alert>
                                        <LoginCard />
                                    </>
                                ) : null}
                                {nasDeviceId ? (
                                    // Packages, status, and sessions only make
                                    // sense once the portal is scoped to the
                                    // network of one of the customer's own
                                    // accounts (account switcher / ?nas= link).
                                    <>
                                        {havingIssues ? (
                                            <HavingIssues
                                                adminContacts={adminContacts}
                                            />
                                        ) : (
                                            <>
                                                {data?.session ? (
                                                    <PppoeAccountCard />
                                                ) : (
                                                    <CurrentPackage />
                                                )}
                                            </>
                                        )}

                                        <PackagePricing
                                            packages={packages}
                                            error={packagesError}
                                            loading={packagesLoading}
                                            onRetry={() =>
                                                void loadPppoePortal(
                                                    userId,
                                                    nasDeviceId,
                                                    true,
                                                )
                                            }
                                        />
                                    </>
                                ) : null}
                            </Stack>
                            <Footer />
                            {/* The payment state is local; checkout pricing follows current offers. */}
                            <PaymentFlow
                                key={buyKey}
                                opened={buyOpened}
                                onClose={closeBuy}
                                seed={checkoutSeed}
                                loading={checkoutLoading}
                                serviceAccountId={purchaseAccountId}
                            />
                            <RegisterModal
                                opened={authOpened}
                                onClose={closeAuth}
                                mode={authMode}
                                onModeChange={setAuthMode}
                                packageId={authPackageId}
                                price={authPrice}
                            />
                        </Stack>
                    </ClientContext.Provider>
                </ModalActionsContext.Provider>
            </Container>
        </MantineProvider>
    );
}
