// deno-lint-ignore-file
import { ModalContext, XHRResponse } from '../../Main.tsx';

import { IoMdRefresh } from 'react-icons/io';
import { useContext } from 'react';

export function PaymentError() {
    const XHRSignal = useContext(XHRResponse);
    const modalSignal = useContext(ModalContext);
    return (
        <div className='flex w-full flex-col items-center gap-8 p-4 text-center'>
            <p className='text-xl font-semibold text-gray-800'>
                Error Processing Payment
            </p>

            <div className='flex h-fit w-fit items-center rounded-full bg-red-50'>
                <div className='m-6 rounded-full bg-red-100'>
                    <div className='m-6 rounded-full bg-red-200'>
                        <svg
                            xmlns='http://www.w3.org/2000/svg'
                            className='h-48 w-48 text-red-600'
                            fill='none'
                            viewBox='0 0 24 24'
                            stroke='currentColor'
                        >
                            <path
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeWidth='2'
                                d='M6 18L18 6M6 6l12 12'
                            />
                        </svg>
                    </div>
                </div>
            </div>

            <p className='text-error text-sm'>
                {XHRSignal.value?.message ||
                    'An error occured while handling your payment. Please try again.'}
            </p>

            <div className='flex w-full'>
                <button
                    className='btn btn-error btn-outline flex-grow shadow-lg'
                    onClick={() => (modalSignal.value = 'payment')}
                >
                    <span className='flex gap-4 align-middle'>
                        <span className='h-full'>
                            <IoMdRefresh />
                        </span>
                        <span>Retry</span>
                    </span>
                </button>
            </div>
        </div>
    );
}
