// Small string helpers shared across apps.

const ID_CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function shortId(length = 8): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => ID_CHARS[byte % ID_CHARS.length]).join(
        '',
    );
}

export function upperFirstCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
