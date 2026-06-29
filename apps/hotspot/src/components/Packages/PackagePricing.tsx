import { dayjs, upperFirstCase } from '../../libs/utils/utils.ts';
import {
    ModalContext,
    OrderContext,
    PackagesContext,
    SessionContext,
} from '../Main.tsx';

import { useSignal } from '../libs/hooks/useSignal.ts';
import humanFormat from 'human-format';
import { useContext } from 'react';
import { Package } from '../../../types/index.d.ts';

type Packages = [string, Array<Package>];

export const dataScale = new humanFormat.Scale({
    Kbps: 1,
    Mbps: 1e3,
    Gbps: 1e6,
});

function getPackages(title: string, packages: Array<Packages>) {
    const h = packages.find(
        ([t, _]) => t.toLowerCase() === title.toLowerCase(),
    );
    return h ? h[1] : [];
}

export function PackagePricing() {
    const pkgContext = useContext(PackagesContext);

    const stateSignal = useSignal({
        selectedTitle: pkgContext[0][0],
        packages: pkgContext[0][1],
    });

    const modal = useContext(ModalContext);
    const session = useContext(SessionContext);
    const order = useContext(OrderContext);
    const { selectedTitle, packages } = stateSignal.value;

    function initiateOrderFlow(pkg: Required<Package>) {
        order.value = {
            ...order.value,
            packageId: pkg.packageId,
            price: String(pkg.price),
        };

        if (session && session.expiresAt > Date.now()) modal.value = 'payment';
        else modal.value = 'login';
    }

    return (
        <div className='mb-4 w-full rounded-2xl bg-white shadow-xl'>
            <div className='p-4'>
                <h3 className='mb-4 w-full justify-center text-lg font-semibold'>
                    Our Packages
                </h3>
                {/* <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,_minmax(min(100%,_calc(100%/5)),_1fr))]">
                 */}
                <div className='mx-auto grid max-w-xl gap-4 [grid-template-columns:repeat(auto-fit,_minmax(min(100%,_calc(100%/5)),_1fr))]'>
                    {pkgContext.map(([title, _]) => (
                        <div
                            className={`btn hover:text-primary min-w-fit rounded-lg bg-gray-100 hover:bg-purple-100 ${
                                title.toLowerCase() ===
                                    selectedTitle.toLowerCase() &&
                                'btn-outline bg-purple-200'
                            }`}
                            onClick={() => {
                                stateSignal.value = {
                                    selectedTitle: title,
                                    packages: getPackages(title, pkgContext),
                                };
                            }}
                        >
                            {upperFirstCase(title)}
                        </div>
                    ))}
                </div>
            </div>

            {packages.map((pkg) => (
                <div className='card m-4 rounded-2xl bg-gray-100 shadow hover:bg-purple-100'>
                    <div className='p-4'>
                        <div className='flex items-center justify-between'>
                            <div className='flex flex-col justify-between gap-3'>
                                <p className='text-gray-500'>{pkg.title}</p>

                                <h2 className='max-w-fit text-4xl font-bold'>
                                    {humanFormat(pkg.downloadRate, {
                                        scale: dataScale,
                                    })}
                                </h2>
                            </div>

                            <div className='flex flex-col items-end justify-between gap-3'>
                                <p className='text-sm text-gray-500'>
                                    {dayjs
                                        .duration(pkg.initialSessionLength, 'm')
                                        .humanize()}
                                </p>

                                <p className='text-2xl font-bold'>
                                    Ksh {pkg.price.toLocaleString()}
                                </p>
                            </div>
                        </div>

                        <div
                            className='btn mt-4 w-full rounded-lg bg-purple-600 px-4 py-2 text-white hover:bg-purple-700'
                            onClick={() => initiateOrderFlow(pkg as Package)}
                        >
                            Buy Now
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
