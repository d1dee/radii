import type { WhatsAppConfig, WhatsAppConfigInput, WhatsAppOutbox, WhatsAppOutboxJob, WhatsAppSession, WhatsAppStatus } from './api';
import { formatDateTime } from './format';

export const whatsAppStates: Record<WhatsAppStatus, { label: string; color: string; description: string }> = {
    DISABLED: { label: 'Not configured', color: 'gray', description: 'Set your WAHA URL and API key in Settings / Messaging, or explicitly select an available global configuration there.' },
    NOT_CREATED: { label: 'Not connected', color: 'gray', description: 'Add a WhatsApp account to create and start your admin connection.' },
    STOPPED: { label: 'Stopped', color: 'gray', description: 'Start the connection to reconnect your account or get a pairing QR code.' },
    STARTING: { label: 'Starting', color: 'blue', description: 'WhatsApp is starting. If a QR code appears below, scan it to link your account. Connection status updates automatically.' },
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
        && typeof config.configured === 'boolean'
        && !!config.safety && validateWhatsAppConfig({ useGlobalConfig: config.useGlobalConfig, safety: config.safety }) === null;
}

export function validateWhatsAppConfig({ baseUrl, apiKey, clearApiKey, safety }: WhatsAppConfigInput) {
    if (safety && (!Number.isInteger(safety.minDelaySeconds) || safety.minDelaySeconds < 30 || safety.minDelaySeconds > 3599
        || !Number.isInteger(safety.maxDelaySeconds) || safety.maxDelaySeconds <= safety.minDelaySeconds || safety.maxDelaySeconds > 3600
        || !Number.isInteger(safety.perContactHourlyLimit) || safety.perContactHourlyLimit < 1 || safety.perContactHourlyLimit > 4))
        return 'Use a random delay of 30-3600 seconds (maximum greater than minimum) and 1-4 messages per contact per hour.';
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

export function createWhatsAppRequestId(): string {
    // Unlike randomUUID(), getRandomValues() is available on HTTP LAN origins.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isWhatsAppOutbox(value: unknown): value is WhatsAppOutbox {
    if (!value || typeof value !== 'object') return false;
    const outbox = value as WhatsAppOutbox;
    return typeof outbox.paused === 'boolean' && Number.isFinite(outbox.nextAt)
        && (outbox.waitingReason === undefined || (typeof outbox.waitingReason === 'string' && outbox.waitingReason.length <= 1000))
        && Array.isArray(outbox.jobs) && outbox.jobs.length <= 100
        && outbox.jobs.every((j) => j && typeof j.id === 'string' && typeof j.batchId === 'string'
            && typeof j.phone === 'string' && /^\d{8,15}$/.test(j.phone)
            && ['queued', 'processing', 'accepted', 'failed', 'uncertain', 'cancelled'].includes(j.status)
            && Number.isFinite(j.createdAt) && (j.result === undefined || typeof j.result === 'string')
            && (j.preview === undefined || (typeof j.preview === 'string' && j.preview.length <= 4096))
            && (j.sentAt === undefined || (Number.isFinite(j.sentAt) && j.sentAt > 0 && j.sentAt < 8_640_000_000_000_000))
            && (j.receiptCheckedAt === undefined || Number.isFinite(j.receiptCheckedAt))
            && (j.ack === undefined || (Number.isInteger(j.ack) && j.ack >= -1 && j.ack <= 4)));
}

export function whatsAppReceiptDisplay(job: WhatsAppOutboxJob) {
    if (job.status === 'accepted') {
        if (job.ack === 3 || job.ack === 4) return { label: 'Read', detail: 'WhatsApp confirmed the recipient read the message.', ticks: 2, color: 'blue' };
        if (job.ack === 2) return { label: 'Delivered', detail: 'WhatsApp confirmed delivery to the recipient device.', ticks: 2, color: 'green' };
        if (job.ack === 1) return { label: 'Sent', detail: 'WhatsApp server received the message; recipient delivery is not confirmed.', ticks: 1, color: 'dimmed' };
        if (job.ack === -1) return { label: 'Delivery error', detail: 'WhatsApp reported a message acknowledgement error. Never automatically resent.', ticks: 0, color: 'red' };
        return { label: 'Service accepted', detail: 'Accepted by the service; sent, delivery and read confirmation are not available yet.', ticks: 0, color: 'dimmed' };
    }
    return { label: job.status, detail: job.result ?? 'Waiting for processing; not confirmed sent.', ticks: 0,
        color: ['failed', 'uncertain'].includes(job.status) ? 'red' : 'dimmed' };
}

export function whatsAppMessageTime(job: WhatsAppOutboxJob) {
    return `${job.sentAt ? 'Sent' : 'Queued'} ${formatDateTime(job.sentAt ?? job.createdAt)}`;
}
