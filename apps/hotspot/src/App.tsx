import '@mantine/core/styles.css';

import { Container, MantineProvider } from '@mantine/core';
import type { MainPageProps, Session } from '@radii/shared';
import Index from './components/Main.tsx';
import { authClient } from './lib/auth.ts';

export default function App() {
    // SPA entry point: fetch initial data from the REST API and resolve the
    // better-auth session instead of receiving SSR props.
    const { data: sessionData } = authClient.useSession();

    const adminContacts = {
        ADMIN_TEL: '',
        ADMIN_WHATSAPP: '',
    };

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
        session,
    };

    return (
        <MantineProvider defaultColorScheme='auto'>
            <Container size='sm' p='md'>
                <Index data={data} adminContacts={adminContacts} />
            </Container>
        </MantineProvider>
    );
}
