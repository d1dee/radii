import '@mantine/core/styles.css';

import { Container, MantineProvider } from '@mantine/core';
import type { MainPageProps, Session } from '@radii/shared';
import { LOGIN_REQUEST_KEY } from './components/HotspotLoginRedirect.tsx';
import Index from './components/Main.tsx';
import { authClient } from './lib/auth.ts';

// The NAS hotspot login page hands the client browser to the portal with a
// `login_request` id (see POST /api/hotspot/login-request). Persist the id
// so it survives the sign-in flow, then clean the URL.
const capturedLoginRequestId = new URLSearchParams(window.location.search).get(
    'login_request',
);
if (capturedLoginRequestId) {
    localStorage.setItem(LOGIN_REQUEST_KEY, capturedLoginRequestId);
    const cleaned = new URLSearchParams(window.location.search);
    cleaned.delete('login_request');
    const query = cleaned.toString();
    window.history.replaceState(
        null,
        '',
        query
            ? `${window.location.pathname}?${query}`
            : window.location.pathname,
    );
}

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
