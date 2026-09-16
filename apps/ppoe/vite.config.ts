import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const API_URL = env.VITE_API_URL;
    const APP_PORT = parseInt(env.VITE_APP_PORT || '');
    const PORTAL_URL = env.VITE_PORTAL_URL;

    if (!API_URL || isNaN(APP_PORT) || !PORTAL_URL)
        throw new Error(
            'VITE_API_URL, VITE_APP_PORT and VITE_PORTAL_URL environment variables are required',
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
        build: {
            rolldownOptions: {
                output: {
                    codeSplitting: {
                        groups: [
                            {
                                name: 'react-vendor',
                                test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/,
                                entriesAware: true,
                                priority: 50,
                            },
                            {
                                name: 'mantine-vendor',
                                test: /node_modules[\\/]@mantine[\\/]/,
                                entriesAware: true,
                                priority: 40,
                            },
                            {
                                name: 'charts-vendor',
                                test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/,
                                entriesAware: true,
                                priority: 60,
                            },
                            {
                                name: 'auth-vendor',
                                test: /node_modules[\\/](better-auth|better-fetch|nanostores)[\\/]/,
                                entriesAware: true,
                                priority: 20,
                            },
                            {
                                name: 'icons-vendor',
                                test: /node_modules[\\/](@tabler|react-icons)[\\/]/,
                                entriesAware: true,
                                priority: 20,
                            },
                            {
                                name: 'vendor',
                                test: /node_modules/,
                                entriesAware: true,
                                priority: 10,
                            },
                        ],
                    },
                },
            },
        },
        publicDir: '../shared/public',
    };
});
