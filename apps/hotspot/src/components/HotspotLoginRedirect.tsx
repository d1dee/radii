import { Button, Loader, Stack, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { completeLoginRequest, type HotspotRedirectData } from '../lib/api.ts';

export const LOGIN_REQUEST_KEY = 'radii.loginRequestId';

// Completes an external captive-portal login request once the client is
// authenticated on the portal: fetches the issued hotspot credentials and
// re-submits them to the NAS servlet login page so the client gets online.
export function HotspotLoginRedirect({ id }: { id: string }) {
    const [redirect, setRedirect] = useState<HotspotRedirectData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const submitted = useRef(false);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const res = await completeLoginRequest(id);
            if (cancelled) return;
            localStorage.removeItem(LOGIN_REQUEST_KEY);
            if (res.success && res.data) {
                setRedirect(res.data);
            } else {
                setError(
                    res.success
                        ? 'This hotspot sign-in session has expired.'
                        : res.message,
                );
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [id]);

    useEffect(() => {
        if (redirect && !submitted.current && formRef.current) {
            submitted.current = true;
            formRef.current.submit();
        }
    }, [redirect]);

    if (error) {
        return (
            <Stack align='center' gap='sm' mt='xl'>
                <Text>Could not complete hotspot sign-in.</Text>
                <Text size='sm' c='dimmed'>
                    {error}
                </Text>
            </Stack>
        );
    }

    if (!redirect) {
        return (
            <Stack align='center' gap='sm' mt='xl'>
                <Loader />
                <Text size='sm' c='dimmed'>
                    Finalizing your connection&hellip;
                </Text>
            </Stack>
        );
    }

    return (
        <form ref={formRef} action={redirect.linkLoginOnly} method='post'>
            <input type='hidden' name='username' value={redirect.username} />
            <input type='hidden' name='password' value={redirect.password} />
            <input type='hidden' name='domain' value='' />
            <input type='hidden' name='dst' value={redirect.dst} />
            <input type='hidden' name='popup' value='true' />
            <noscript>
                <Stack align='center' gap='sm'>
                    <Text size='sm'>JavaScript is disabled.</Text>
                    <Button type='submit'>Connect</Button>
                </Stack>
            </noscript>
        </form>
    );
}
