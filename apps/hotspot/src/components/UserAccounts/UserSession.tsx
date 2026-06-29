import { ClientContext, SessionContext } from '../Main.tsx';

import { Signal } from '../libs/hooks/useSignal.ts';
import { useContext } from 'react';
import fetch from 'better-fetch';

export function UserSession({
    havingIssues,
}: {
    havingIssues: Signal<boolean>;
}) {
    const client = useContext(ClientContext);
    const session = useContext(SessionContext);
    return (
        <div className='w-full'>
            <h2 className='mb-2 text-xl font-semibold'>Hello,</h2>

            <div className='flex justify-between'>
                <p className='text-sm text-slate-300'>{client?.phoneNumber}</p>

                <div
                    className='btn btn-ghost border border-purple-400 shadow-sm'
                    onClick={() => {
                        session && (havingIssues.value = !havingIssues.value);
                    }}
                >
                    {!havingIssues.value ? (
                        <span className='mx-4'>Having issues?</span>
                    ) : (
                        <span className='mx-4'>Active package</span>
                    )}
                </div>
            </div>
        </div>
    );
}

function endSession(sessionKey: string) {
    try {
        const params = new URLSearchParams(location.search);
        params.set('dropSession', sessionKey);

        fetch(`nds?${params.toString()}`, {
            method: 'get',
        }).then((res: Response) => {
            if (res.ok) {
                res.json().then((jsonResponse) => {
                    if (jsonResponse.success) {
                        const newParams = new URLSearchParams();
                        newParams.set('fas', params.get('fas') ?? '');

                        location.replace(
                            `${location.origin}/nds?${newParams.toString()}`,
                        );
                    } else {
                        console.warn('failed to close session');
                    }
                });
            } else {
                res.text().then((text) =>
                    document.documentElement.replaceWith(
                        new DOMParser().parseFromString(text, 'text/html')
                            .documentElement,
                    ),
                );
            }
        });
    } catch (err) {
        console.log(err);
    }
}
