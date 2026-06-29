import { Client, Package, Session, StatusQuotas } from '../../types/index.d.ts';
import { useSignal, type Signal } from '../libs/hooks/useSignal.ts';

import { createContext, useEffect } from 'react';
import type { XHRResultError, XHRResultSuccess } from '../libs/utils/fetch.ts';
import { MainPageProps } from '../routes/nds/index.tsx';
import { BuyPackage } from './Buy/Modal.tsx';
import { OrderStatus } from './Buy/Payments/PaymentStatus.tsx';
import { ConnectedDevicesModal } from './Packages/ConnectedDevicesModal.tsx';
import { CurrentPackage } from './Packages/CurrentPackage.tsx';
import { HavingIssues } from './Packages/HavingIssues.tsx';
import { PackagePricing } from './Packages/PackagePricing.tsx';
import RegisterModal from './RegisterForm/Modal.tsx';
import { UserAccount } from './UserAccounts/UserAccount.tsx';

export type Modal =
    | 'register'
    | 'payment'
    | 'status'
    | 'login'
    | 'connectedDevices'
    | undefined;

export type OrderStates = 'pending' | 'errored' | 'success' | '';
export type Order = {
    packageId: string;
    price: string;
    phoneNumber: string;
    status: OrderStates;
    orderId: string;
};

export const ModalContext = createContext<Signal<Modal>>(null!);
export const SessionContext = createContext<Session | undefined>(null!);
export const ClientContext = createContext<Client | undefined>(null!);
export const PackagesContext = createContext<Array<[string, Array<Package>]>>(
    null!,
);
export const OrderContext = createContext<Signal<Order>>(null!);
export const QuotaContext = createContext<Signal<StatusQuotas | undefined>>(
    null!,
);
export const HavingIssuesContext = createContext<Signal<boolean | undefined>>(
    null!,
);
export const XHRResponse = createContext<
    Signal<XHRResultError | XHRResultSuccess | undefined>
>(null!);

export default function Index({
    data,
    adminContacts,
}: {
    data: MainPageProps;
    adminContacts: { ADMIN_TEL: string; ADMIN_WHATSAPP: string };
}) {
    const XHRSignal = useSignal(undefined);
    const quotaSignal = useSignal(data.quotas);
    const modalSignal = useSignal<Modal>(
        data.session && localStorage.getItem('packageId')
            ? 'payment'
            : undefined,
    );
    const havingIssues = useSignal(false);
    const localStoragePackageId = localStorage.getItem('packageId');

    const orderSignal = useSignal({
        packageId: localStoragePackageId || '',
        price: String(
            data?.dbPackages
                ?.flat(2)
                .find(
                    (v): v is Package =>
                        typeof v !== 'string' &&
                        v?.packageId === localStoragePackageId,
                )?.price || '',
        ),
        phoneNumber: '',
        status: '' as OrderStates,
        orderId: '',
    });

    // Remove packageId from url after login
    useEffect(() => {
        orderSignal.value.packageId && localStorage.removeItem('packageId');
    }, []);

    return (
        <ModalContext.Provider value={modalSignal}>
            <SessionContext.Provider value={data.session}>
                <ClientContext.Provider value={data.client}>
                    <UserAccount havingIssues={havingIssues} />
                    <QuotaContext.Provider value={quotaSignal}>
                        {havingIssues.value ? (
                            <HavingIssues adminContacts={adminContacts} />
                        ) : (
                            <CurrentPackage />
                        )}
                        {modalSignal.value === 'connectedDevices' ? (
                            <ConnectedDevicesModal />
                        ) : null}
                    </QuotaContext.Provider>
                    <OrderContext.Provider value={orderSignal}>
                        {data?.dbPackages ? (
                            <PackagesContext.Provider value={data.dbPackages}>
                                <PackagePricing />
                            </PackagesContext.Provider>
                        ) : (
                            <>This gateway has not been onborded</>
                        )}
                        {modalSignal.value === 'register' ||
                        modalSignal.value === 'login' ? (
                            <RegisterModal />
                        ) : null}
                        <HavingIssuesContext.Provider value={havingIssues}>
                            <XHRResponse.Provider value={XHRSignal}>
                                {modalSignal.value === 'payment' ? (
                                    <BuyPackage />
                                ) : null}
                                {modalSignal.value === 'status' ? (
                                    <OrderStatus />
                                ) : null}
                            </XHRResponse.Provider>
                        </HavingIssuesContext.Provider>
                    </OrderContext.Provider>
                </ClientContext.Provider>
            </SessionContext.Provider>
        </ModalContext.Provider>
    );
}
