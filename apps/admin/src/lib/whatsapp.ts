import type { WhatsAppConfig, WhatsAppConfigInput, WhatsAppSession, WhatsAppStatus } from './api';

export const whatsAppStates: Record<WhatsAppStatus, { label: string; color: string; description: string }> = {
    DISABLED: { label: 'Not configured', color: 'gray', description: 'Set your WAHA URL and API key in Settings / Messaging, or explicitly select an available global configuration there.' },
    NOT_CREATED: { label: 'Not connected', color: 'gray', description: 'Add a WhatsApp account to create and start your admin connection.' },
    STOPPED: { label: 'Stopped', color: 'gray', description: 'Start the connection to reconnect your account or get a pairing QR code.' },
    STARTING: { label: 'Starting', color: 'blue', description: 'WhatsApp is starting. Connection status updates automatically.' },
    SCAN_QR_CODE: { label: 'Scan QR code', color: 'yellow', description: 'Link your WhatsApp account using the QR code below. The code refreshes automatically.' },
    WORKING: { label: 'Connected', color: 'green', description: 'Your WhatsApp account is connected and ready to send messages.' },
    FAILED: { label: 'Connection failed', color: 'red', description: 'Restart the connection to try again. If it keeps failing, contact the server operator.' },
    PASSKEY_REQUIRED: { label: 'Passkey required', color: 'orange', description: 'WhatsApp requires a passkey. This page cannot complete passkey authentication. Check WhatsApp on your phone or contact the server operator.' },
    PASSKEY_CONFIRMATION_REQUIRED: { label: 'Passkey confirmation required', color: 'orange', description: 'Confirm the WhatsApp passkey request on your phone. If no request appears, contact the server operator. This page cannot confirm a passkey.' },
};

export function isWhatsAppConfig(value: unknown): value is WhatsAppConfig {
    if (!value || typeof value !== 'object' || 'apiKey' in value || 'apiKeyEncrypted' in value) return false;
    const config = value as WhatsAppConfig;
    return typeof config.baseUrl === 'string' && typeof config.useGlobalConfig === 'boolean'
        && typeof config.hasApiKey === 'boolean' && typeof config.globalConfigured === 'boolean'
        && (config.apiKeyPreview === null || (config.hasApiKey && typeof config.apiKeyPreview === 'string'
            && /^[\x21-\x7e]{0,4}\*{3,}$/.test(config.apiKeyPreview)))
        && typeof config.configured === 'boolean';
}

export function validateWhatsAppConfig({ baseUrl, apiKey, clearApiKey }: WhatsAppConfigInput) {
    if (baseUrl) {
        try {
            const url = new URL(baseUrl);
            if (baseUrl.length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
                || url.pathname !== '/' || url.search || url.hash) throw new Error();
        } catch {
            return 'Use an HTTP(S) origin without credentials, path, query or fragment.';
        }
    }
    if (apiKey && clearApiKey) return 'Choose either a replacement key or removal of the saved key, not both.';
    if (apiKey && (apiKey.length > 4096 || !/^[\x21-\x7e]+$/.test(apiKey))) return 'Use an API key without whitespace or non-ASCII characters.';
    return null;
}

export function isWhatsAppSession(value: unknown): value is WhatsAppSession {
    if (!value || typeof value !== 'object') return false;
    const session = value as WhatsAppSession;
    return typeof session.configured === 'boolean' && Object.hasOwn(whatsAppStates, session.status)
        && (session.configured ? session.status !== 'DISABLED' : session.status === 'DISABLED');
}

export function validateWhatsAppText({ phone, text }: { phone: string; text: string }) {
    return {
        phone: phone === phone.trim() && /^\+?[1-9]\d{7,14}$/.test(phone) ? null : 'Use 8-15 digits including the country code, with an optional leading +. Do not include spaces or punctuation.',
        text: text.length >= 1 && text.length <= 4096 && text.trim().length > 0 && !text.includes('\0')
            ? null : 'Enter 1-4096 characters, not just whitespace, without NUL characters.',
    };
}
