import { resolve, sep } from 'node:path';

const address = Bun.env.SERVER_ADDRESS;
const publicUrl = Bun.env.SERVER_PUBLIC_URL;
const port = Number(Bun.env.SERVER_PORT);
if (
    !address ||
    !publicUrl ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
)
    throw new Error(
        'SERVER_ADDRESS, SERVER_PUBLIC_URL and a valid SERVER_PORT are required',
    );
const canonical = new URL(publicUrl);
if (
    !['http:', 'https:'].includes(canonical.protocol) ||
    canonical.username ||
    canonical.password
)
    throw new Error(
        'SERVER_PUBLIC_URL must be an HTTP(S) URL without credentials',
    );
const dist = resolve(import.meta.dirname, 'dist');
const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
        "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
};
Bun.serve({
    hostname: address,
    port,
    async fetch(req) {
        const url = new URL(req.url);
        // Only Host is authoritative. A proxy must preserve it and strip untrusted forwarding headers.
        if (
            req.headers.get('host')?.toLowerCase() !==
            canonical.host.toLowerCase()
        ) {
            const location = new URL(canonical);
            location.pathname = url.pathname;
            location.search = url.search;
            return new Response(null, {
                status: 302,
                headers: {
                    ...headers,
                    Location: location.href,
                    'Cache-Control': 'no-store',
                },
            });
        }
        if (!['GET', 'HEAD'].includes(req.method))
            return new Response('Method not allowed', { status: 405, headers });
        if (url.pathname === '/api' || url.pathname.startsWith('/api/'))
            return new Response(
                'Configure the trusted reverse proxy to route /api to the Radii API.',
                { status: 502, headers },
            );
        let pathname: string;
        try {
            pathname = decodeURIComponent(url.pathname);
        } catch {
            return new Response('Invalid path', { status: 400, headers });
        }
        const path = resolve(dist, `.${pathname}`);
        if (!path.startsWith(`${dist}${sep}`) && path !== dist)
            return new Response('Not found', { status: 404, headers });
        const file = Bun.file(path);
        if (
            path !== dist &&
            (await file.exists()) &&
            !(await file.stat()).isDirectory()
        )
            return new Response(req.method === 'HEAD' ? null : file, {
                headers: { ...headers, 'Content-Type': file.type },
            });
        if (/\.[^/]+$/.test(pathname))
            return new Response('Not found', { status: 404, headers });
        return new Response(
            req.method === 'HEAD'
                ? null
                : Bun.file(resolve(dist, 'index.html')),
            {
                headers: {
                    ...headers,
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-store',
                },
            },
        );
    },
});
