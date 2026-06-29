export function writeLog(options?: unknown) {
    // This function can be extended to handle different logging options
    // For now, it just returns a simple logger interface
    // You can implement different log levels or formats based on the options provided

    return {
        debug: (message: string, info?: object) => console.debug(message, info),
        info: (message: string, info?: object) => console.info(message, info),
        warn: (message: string, error?: Error) => console.warn(message, error),
        error: (message: string, error?: Error) =>
            console.error(message, error),
        fatal: (message: string, error?: Error) =>
            console.error(message, error),
    };
}
