import { AsyncLocalStorage } from 'node:async_hooks';
import { inspect } from 'node:util';
import {
    configure,
    dispose,
    getAnsiColorFormatter,
    getConsoleSink,
    getJsonLinesFormatter,
    getLogger,
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
    || (!process.env.LOG_FORMAT && !!process.env.JOURNAL_STREAM);
const jsonOutput = journalOutput || process.env.LOG_FORMAT === 'json';
// systemd consumes these prefixes when SyslogLevelPrefix=yes.
const journalPriorities: Record<LogLevel, number> = {
    trace: 7,
    debug: 7,
    info: 6,
    warning: 4,
    error: 3,
    fatal: 2,
};
const jsonFormatter = getJsonLinesFormatter();

globalRef.__apiLoggingConfigured ??= configure({
    sinks: {
        console: redactByField(
            getConsoleSink({
                formatter: jsonOutput ? (record) => {
                        // Redact decoded values so patterns cannot consume JSON delimiters.
                        const line = JSON.stringify(JSON.parse(jsonFormatter(record)), (_key, value) =>
                            typeof value === 'string'
                                ? sensitiveValuePatterns.reduce(
                                    (text, { pattern, replacement }) => typeof replacement === 'string'
                                        ? text.replace(pattern, replacement)
                                        : text.replace(pattern, replacement),
                                    value,
                                )
                                : value,
                        );
                        return journalOutput
                            ? `<${journalPriorities[record.level]}>${line}`
                            : line;
                    } : redactByPattern(getAnsiColorFormatter({
                        timestamp: 'rfc3339',
                        timestampStyle: null,
                        level: (level) =>
                            level === 'warning' ? 'WARN' : level.toUpperCase(),
                        value: (value) =>
                            typeof value === 'string'
                                ? value
                                : inspect(value, {
                                      colors: false,
                                      compact: true,
                                      breakLength: Infinity,
                                  }),
                        format: ({ timestamp, level, message, record }) => {
                            const details =
                                Object.keys(record.properties).length > 0
                                    ? ` ${inspect(record.properties, {
                                          colors: false,
                                          compact: true,
                                          breakLength: Infinity,
                                      })}`
                                    : '';
                            return `${timestamp} ${level} ${record.category.join('.')} ${message}${details}`.replace(
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
