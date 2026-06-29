import { useSignal } from '../libs/hooks/useSignal.ts';

import { AdminContacts } from '../../components/AdminContacts.tsx';
import { fetchXHR } from '../../libs/utils/fetch.ts';

export function HavingIssues({
    adminContacts,
}: {
    adminContacts: { ADMIN_TEL: string; ADMIN_WHATSAPP: string };
}) {
    const message = useSignal(undefined) as import('../libs/hooks/useSignal.ts').Signal<
        | {
              success?: true;
              message: string;
              data?: Record<PropertyKey, unknown>;
          }
        | undefined
    >;

    const verifyTransaction = (e: HTMLFormElement) => {
        const value = new FormData(e).get('transactionMessage') as string;
        // Parse first word (M-pesa transaction ID is usually the first word)
        const transactionId = value.trim().split(/\s+/)[0];
        console.log('Transaction ID:', transactionId);

        // validate transaction ID format
        const isValidTransactionId = /^[0-9A-Z]{10}$/i.test(transactionId);
        if (!isValidTransactionId) {
            message.value = { message: 'Invalid transaction ID format' };

            return;
        } else {
            message.value = {
                success: true,
                message: 'Processing...',
            };
        }

        // Call the API to verify the transaction

        const interval = setInterval(async () => {
            try {
                const res = await fetchXHR('/nds/verify-transaction', {
                    transactionId: transactionId,
                });
                if (!res || res.success === false) {
                    clearInterval(interval);
                    message.value = {
                        message:
                            res?.message || 'Transaction verification failed',
                    };
                } else {
                    if (res.message === 'pending') {
                        message.value = {
                            success: true,
                            message: 'Processing...',
                        };
                    } else {
                        clearInterval(interval);
                        message.value = {
                            success: true,
                            message: res.message,
                        };
                    }
                }
            } catch (error) {
                console.error('Error verifying transaction:', error);
                message.value = { message: 'Error verifying transaction.' };
            }
        }, 3e3);
    };

    return (
        <div className='flex w-full flex-col gap-4 rounded-2xl bg-white px-4 py-6 shadow-xl'>
            <h3 className='text-lg font-semibold'>Having Issues?</h3>

            {/* Transaction Verification Section */}
            <div className='flex flex-col gap-3 rounded-2xl bg-purple-100 p-4'>
                <h4 className='font-medium'>Verify Transaction:</h4>

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        verifyTransaction(e.currentTarget);
                    }}
                    className='form-control'
                >
                    <div className={`flex gap-4`}>
                        <input
                            type='text'
                            placeholder='Enter transaction ID or paste your M-pesa message here'
                            className={`input flex-1 rounded-lg text-sm ${!message.value ? 'input-primary' : message.value.success ? 'input-success' : 'input-error'}`}
                            name='transactionMessage'
                            required
                        />
                        <button
                            className='btn btn-primary px-4 py-2 text-sm'
                            type='submit'
                        >
                            Verify
                        </button>
                    </div>

                    <label
                        className={`label-text label ${message.value?.success ? 'text-success' : 'text-error'} text-sm`}
                        htmlFor='transactionMessage'
                    >
                        {message.value?.message}
                    </label>
                </form>
            </div>
            <AdminContacts adminContacts={adminContacts} />
        </div>
    );
}
