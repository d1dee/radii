import { AsyncLocalStorage } from 'node:async_hooks';
import {
    configure,
    dispose,
    getConsoleSink,
    getJsonLinesFormatter,
    getLogger,
    parseLogLevel,
} from '@logtape/logtape';
import {
    CREDIT_CARD_NUMBER_PATTERN,
    DEFAULT_REDACT_FIELDS,
    EMAIL_ADDRESS_PATTERN,
    JWT_PATTERN,
    redactByField,
    redactByPattern,
} from '@logtape/redaction';

const sensitiveValuePatterns = [
    EMAIL_ADDRESS_PATTERN,
    CREDIT_CARD_NUMBER_PATTERN,
    JWT_PATTERN,
    {
        pattern: /(?:\+\d[\d ()-]{8,}\d|\b0\d{9,14}\b|\b254\d{9}\b)/g,
        replacement: '[PHONE REDACTED]',
    },
    {
        pattern:
            /\b(password|passcode|pin|otp|token|secret|authorization)(\s*[:=]\s*)\S+/gi,
        replacement: '$1$2[REDACTED]',
    },
];

const globalRef = globalThis as unknown as {
    __apiLoggingConfigured?: Promise<void>;
};

globalRef.__apiLoggingConfigured ??= configure({
    sinks: {
        console: redactByField(
            getConsoleSink({
                formatter: redactByPattern(
                    getJsonLinesFormatter({ properties: 'flatten' }),
                    sensitiveValuePatterns,
                ),
            }),
            {
                fieldPatterns: [
                    ...DEFAULT_REDACT_FIELDS,
                    /e-?mail/i,
                    /phone|mobile|msisdn/i,
                    /credential/i,
                    /pass(?:code|phrase|word)/i,
                    /\bpin\b/i,
                    /\botp\b/i,
                    /^username$/i,
                    /mac|callingStation/i,
                    /receipt|transactionCode/i,
                    /provider(?:Reference|RequestId|ConversationId|TransactionId)/i,
                ],
                action: () => '[REDACTED]',
            },
        ),
    },
    loggers: [
        {
            category: ['radii', 'api'],
            lowestLevel: parseLogLevel(process.env.LOG_LEVEL || 'info'),
            sinks: ['console'],
        },
        {
            category: ['logtape', 'meta'],
            lowestLevel: 'warning',
            sinks: ['console'],
        },
    ],
    contextLocalStorage: new AsyncLocalStorage<Record<string, unknown>>(),
});

await globalRef.__apiLoggingConfigured;

export const apiLogger = getLogger(['radii', 'api']);
export { dispose as disposeLogging };
