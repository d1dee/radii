import {
    configureSync,
    getConsoleSink,
    getLogger,
    type LogLevel,
} from '@logtape/logtape';

const consoleLevel: LogLevel = import.meta.env.DEV ? 'debug' : 'warning';

configureSync({
    sinks: {
        console: getConsoleSink(),
    },
    loggers: [
        {
            category: ['radii', 'admin'],
            lowestLevel: consoleLevel,
            sinks: ['console'],
        },
        {
            category: ['logtape', 'meta'],
            lowestLevel: consoleLevel,
            sinks: ['console'],
        },
    ],
});

export const adminLogger = getLogger(['radii', 'admin']);
