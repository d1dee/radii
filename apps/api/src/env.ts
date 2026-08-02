// Centralized environment access. Validates required variables at startup so
// the server fails fast with a clear message instead of crashing mid-request.

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

export const env = {
    baseUrl: required('BASE_URL'),
    port: parseInt(required('PORT'), 10),
    frontendUrls: (process.env.FRONTEND_URLS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
};
