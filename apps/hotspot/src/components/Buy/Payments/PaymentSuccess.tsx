import { ModalContext, XHRResponse } from '../../Main.tsx';

import { IoMdDoneAll } from 'react-icons/io';
import { useContext } from 'react';

export function PaymentSuccess() {
    const modalSignal = useContext(ModalContext);
    return (
        <div className='flex w-full flex-col items-center gap-8 p-4 text-center'>
            <div className='flex'>
                <h3 className='text-xl font-semibold'>Payment Successful</h3>
            </div>
            <div className='flex h-fit w-fit rounded-full bg-purple-50'>
                <div className='m-6 rounded-full bg-purple-100'>
                    <div className='m-6 rounded-full bg-purple-200'>
                        <svg
                            xmlns='http://www.w3.org/2000/svg'
                            className='h-48 w-48 text-purple-500'
                            fill='none'
                            viewBox='0 0 24 24'
                            stroke='currentColor'
                        >
                            <path
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeWidth='2'
                                d='M5 13l4 4L19 7'
                            />
                        </svg>
                    </div>
                </div>
            </div>

            <StatusInfo />

            <div className='flex w-full'>
                <button
                    className='btn btn-outline btn-success flex-grow shadow-lg hover:bg-purple-200'
                    onClick={() => (modalSignal.value = undefined)}
                >
                    <span className='flex gap-4 align-middle'>
                        <span className='h-full'>
                            <IoMdDoneAll />
                        </span>
                        <span>Done</span>
                    </span>
                </button>
            </div>
        </div>
    );
}

function StatusInfo() {
    const XHRSignal = useContext(XHRResponse);

    if (XHRSignal.value?.success) {
        const data = XHRSignal.value.data as {
            amount: string;
            paymentId: string;
            referenceCode: string;
        };
        return (
            <div className='flex flex-col items-center gap-2'>
                <p className='text-success text-lg font-semibold'>
                    Payment of Kes: {data.amount} was Successful.{' '}
                </p>

                <p className='text-sm text-gray-600'>
                    {data.paymentId
                        ? `Payment ID: ${data.paymentId}`
                        : `Ref code:${data.referenceCode}`}
                </p>
                <p>
                    Please wait a few seconds for the system to activate your
                    package.
                </p>
            </div>
        );
    }

    return (
        <>
            <p className='text-xl font-semibold text-gray-800'>Error...</p>
            <p className='text-sm text-gray-600'>
                Unknown error occurred while processing your payment.
            </p>
        </>
    );
}
