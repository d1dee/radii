import type { Signal } from '../../libs/hooks/useSignal.ts';
import { useContext } from 'react';
import { SessionContext } from '../Main.tsx';
import { SigninSignup } from './SignedOutHeader.tsx';
import { UserSession } from './UserSession.tsx';

export function UserAccount({ havingIssues }: { havingIssues: Signal<boolean> }) {
    const session = useContext(SessionContext);
    return (
        <div className='flex w-full items-center gap-4 rounded-2xl bg-purple-600 px-4 py-6 text-white shadow-xl'>
            <div className='rounded-full bg-purple-700'>
                <svg
                    xmlns='http://www.w3.org/2000/svg'
                    fill='none'
                    viewBox='0 0 24 24'
                    className='h-[100px] w-[100px]'
                    stroke='currentColor'
                >
                    <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth='6'
                        d='M5.121 17.804A4 4 0 0112 20a4 4 0 016.879-2.196M15 11a3 3 0 11-6 0 3 3 0 016 0z'
                    />
                </svg>
            </div>

            {session ? <UserSession havingIssues={havingIssues} /> : <SigninSignup />}
        </div>
    );
}
