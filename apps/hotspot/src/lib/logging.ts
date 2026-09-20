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
            category: ['radii', 'hotspot'],
            sinks: ['console'],
            lowestLevel: consoleLevel,
        },
        {
            category: ['logtape', 'meta'],
            sinks: ['console'],
            lowestLevel: consoleLevel,
        },
    ],
});

export const apiLogger = getLogger(['radii', 'hotspot', 'api']);
export const mutationLogger = getLogger(['radii', 'hotspot', 'mutation']);
export const storeLogger = getLogger(['radii', 'hotspot', 'store']);
