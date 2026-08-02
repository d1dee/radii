import '@mantine/core/styles.css';

import { Container, MantineProvider } from '@mantine/core';
import type { Client, MainPageProps, Session } from '@radii/shared';
import { useEffect, useState } from 'react';
import Index from './components/Main.tsx';
import { getMe, getPackages } from './lib/api.ts';
import { authClient } from './lib/auth.ts';

export default function App() {
    // SPA entry point: fetch initial data from the REST API and resolve the
    // better-auth session instead of receiving SSR props.
    const { data: sessionData } = authClient.useSession();

    const [dbPackages, setDbPackages] = useState<MainPageProps['dbPackages']>(
        [],
    );
    const [client, setClient] = useState<Client | undefined>(undefined);

    const adminContacts = {
        ADMIN_TEL: '',
        ADMIN_WHATSAPP: '',
    };

    useEffect(() => {
        getPackages()
            .then((packages) => setDbPackages(packages))
            .catch((err) => console.warn('Failed to load packages', err));
    }, []);

    useEffect(() => {
        if (!sessionData) {
            setClient(undefined);
            return;
        }
        getMe()
            .then((me) =>
                setClient({
                    userId: me.userId,
                    phoneNumber: me.phoneNumber,
                    prevPaymentMethods: me.prevPaymentMethods,
                }),
            )
            .catch((err) => console.warn('Failed to load user', err));
    }, [sessionData]);

    // Bridge the better-auth session into the legacy `{ expiresAt }` shape
    // expected by MainPageProps. `useSession`'s `data` is generically inferred
    // from the client options and resolves to `never` here, so we treat it as
    // a loose record.
    const rawSession = sessionData as {
        session?: { expiresAt?: string | Date };
    } | null;
    const session: Session | undefined = rawSession?.session?.expiresAt
        ? {
              expiresAt: new Date(rawSession.session.expiresAt).getTime(),
          }
        : undefined;

    const data: MainPageProps = {
        dbPackages,
        quotas: undefined,
        session,
        client,
    };

    return (
        <MantineProvider>
            <Container size='sm' p='md'>
                <Index data={data} adminContacts={adminContacts} />
            </Container>
        </MantineProvider>
    );
}
