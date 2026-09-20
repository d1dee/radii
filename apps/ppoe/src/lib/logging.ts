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
            category: ['radii', 'pppoe'],
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

export const apiLogger = getLogger(['radii', 'pppoe', 'api']);
export const mutationLogger = getLogger(['radii', 'pppoe', 'mutation']);
export const storeLogger = getLogger(['radii', 'pppoe', 'store']);
