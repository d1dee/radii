import { AsyncLocalStorage } from 'node:async_hooks';
import { fstatSync } from 'node:fs';
import { inspect } from 'node:util';
import { honoLogger } from '@logtape/hono';
import {
    configure,
    dispose,
    getConsoleSink,
    getLogger,
    getTextFormatter,
    parseLogLevel,
    type LogLevel,
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

const journalOutput =
    process.env.LOG_FORMAT === 'journal'
    || !!process.env.JOURNAL_STREAM;
const stdoutStat = process.env.JOURNAL_STREAM ? fstatSync(1) : undefined;
// A workspace runner forwards through a pipe: journald cannot parse prefixes there.
const directJournal = journalOutput && stdoutStat !== undefined
    && process.env.JOURNAL_STREAM === `${stdoutStat.dev}:${stdoutStat.ino}`;
// systemd consumes these prefixes when SyslogLevelPrefix=yes.
const journalPriorities: Record<LogLevel, number> = {
    trace: 7,
    debug: 7,
    info: 6,
    warning: 4,
    error: 3,
    fatal: 2,
};
const httpSummaryFields = new Set(['method', 'url', 'path', 'status', 'responseTime']);

globalRef.__apiLoggingConfigured ??= configure({
    sinks: {
        console: redactByField(
            getConsoleSink({
                // Keep direct journal output on the stream identified by JOURNAL_STREAM.
                levelMap: directJournal ? {
                    trace: 'log', debug: 'log', info: 'log',
                    warning: 'log', error: 'log', fatal: 'log',
                } : undefined,
                formatter: redactByPattern(
                    getTextFormatter({
                        timestamp: journalOutput ? 'disabled' : 'rfc3339',
                        level: (level) =>
                            level === 'warning' ? 'WARN' : level.toUpperCase(),
                        value: (value) =>
                            typeof value === 'string'
                                ? value
                                : inspect(value, {
                                      colors: false,
                                      compact: true,
                                      depth: 6,
                                      breakLength: Infinity,
                                  }),
                        format: ({ timestamp, level, message, record }) => {
                            const isHttp = record.category.join('.') === 'radii.api.http';
                            const details = Object.entries(record.properties)
                                .filter(([key, value]) => value !== undefined
                                    && !(isHttp && httpSummaryFields.has(key)))
                                .map(([key, value]) => {
                                    const rendered = typeof value === 'string'
                                        ? value
                                        : inspect(value, {
                                          colors: false,
                                          compact: true,
                                          depth: 6,
                                          breakLength: Infinity,
                                        });
                                    return `${key}=${rendered}`;
                                })
                                .join(' ');
                            const prefix = directJournal ? `<${journalPriorities[record.level]}>` : '';
                            const line = [timestamp, level, record.category.join('.'), message, details]
                                .filter(Boolean).join(' ');
                            return `${prefix}${line}`.replace(
                                /\r?\n/g,
                                '\\n',
                            );
                        },
                    }),
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

// Explicit opt-in only: these codes grant account access. Keep ordinary OTP
// fields redacted even when this dedicated debug entry is enabled.
export function logOtpForDebug(channel: 'admin' | 'agent' | 'portal', type: string, code: string): void {
    if (process.env.DEBUG_LOG_OTP !== 'true') return;
    apiLogger.getChild('otp-debug').warn('Sensitive one-time debug code: {debugCode}', {
        channel,
        otpType: type,
        debugCode: code,
    });
}

export const httpLogger = honoLogger({
    category: ['radii', 'api', 'http'],
    format: (c, responseTime) => ({
        method: c.req.method,
        // The adapter's message template uses url; omit query strings and origins.
        url: c.req.path,
        path: c.req.path,
        status: c.res.status,
        responseTime,
    }),
    context: {
        requestId: {
            headerNames: ['x-correlation-id', 'x-request-id'],
            responseHeader: 'x-request-id',
            normalize: (value) => /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null,
        },
        include: ['requestId', 'method'],
        enrich: (c) => ({ path: c.req.path }),
    },
});
