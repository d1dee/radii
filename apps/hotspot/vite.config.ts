import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const API_URL = env.VITE_API_URL;
    const APP_PORT = parseInt(env.VITE_APP_PORT || '');

    if (!API_URL || isNaN(APP_PORT))
        throw new Error(
            'VITE_API_URL and VITE_APP_PORT environment variables are required',
        );

    return {
        plugins: [react()],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
                '@shared': path.resolve(__dirname, '../shared/src'),
            },
            // Force a single React/React-DOM instance across the bundle.
            // Without this, workspace deps like `better-auth` (installed via
            // bun's .bun cache) can resolve their own React copy, producing
            // duplicate instances and "Invalid hook call" errors.
            dedupe: ['react', 'react-dom'],
        },
        server: {
            port: APP_PORT,
            proxy: {
                '/api': {
                    target: API_URL,
                    changeOrigin: true,
                    secure: false,
                },
            },
        },
        publicDir: '../shared/public',
    };
});
