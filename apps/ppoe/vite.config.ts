import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const API_URL = env.VITE_API_URL;
    const APP_PORT = parseInt(env.VITE_APP_PORT || '');
    const PORTAL_URL = env.VITE_PORTAL_URL;

    if ((command === 'serve' && !API_URL) || isNaN(APP_PORT) || !PORTAL_URL)
        throw new Error(
            'VITE_APP_PORT and VITE_PORTAL_URL are required; VITE_API_URL is required for the dev server',
        );

    const canonicalPortalUrl = new URL(PORTAL_URL);

    return {
        plugins: [
            {
                name: 'pppoe-canonical-host-redirect',
                configureServer(server) {
                    server.middlewares.use((req, res, next) => {
                        if (
                            req.headers.host?.toLowerCase() ===
                            canonicalPortalUrl.host.toLowerCase()
                        ) {
                            next();
                            return;
                        }

                        const incomingUrl = new URL(
                            req.url || '/',
                            'http://intercepted.invalid',
                        );
                        const location = new URL(canonicalPortalUrl);
                        location.pathname = incomingUrl.pathname;
                        location.search = incomingUrl.search;
                        location.hash = '';

                        res.statusCode = 302;
                        res.setHeader('Location', location.toString());
                        res.setHeader('Cache-Control', 'no-store');
                        res.end();
                    });
                },
            },
            react(),
        ],
        resolve: {
            alias: {
                '@': path.resolve(import.meta.dirname, './src'),
                '@shared': path.resolve(import.meta.dirname, '../shared/src'),
                '@lib': path.resolve(import.meta.dirname, './src/lib'),
                '@components/*': path.resolve(
                    import.meta.dirname,
                    './src/components',
                ),
                '@types': path.resolve(import.meta.dirname, './src/types'),
            },
            // Force a single React/React-DOM instance across the bundle.
            // Without this, workspace deps like `better-auth` (installed via
            // bun's .bun cache) can resolve their own React copy, producing
            // duplicate instances and "Invalid hook call" errors.
            dedupe: ['react', 'react-dom'],
        },
        server: {
            host: '0.0.0.0',
            port: APP_PORT,
            cors: false,
            proxy: {
                '/api': {
                    target: API_URL,
                    changeOrigin: true,
                    secure: false,
                },
            },
            allowedHosts: true,
        },
        publicDir: '../shared/public',
    };
});
