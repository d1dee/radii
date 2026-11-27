import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { useSession } from '@/lib/auth';
import { SettingsProvider } from '@/lib/settings';
import { TableStateProvider } from '@/lib/tableState';
import { AppLayout } from './AppLayout';
import { LoadingContent } from './LoadingContent';

export default function AuthenticatedLayout() {
    const { data: session } = useSession();
    const { pathname } = useLocation();
    const branch = pathname.split('/')[1] ?? '';

    return (
        <SettingsProvider>
            <AppLayout>
                <TableStateProvider
                    key={`${session?.user.id}:${session?.session.id}:${branch}`}
                >
                    <Suspense fallback={<LoadingContent />}>
                        <Outlet />
                    </Suspense>
                </TableStateProvider>
            </AppLayout>
        </SettingsProvider>
    );
}
