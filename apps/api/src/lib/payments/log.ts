type PaymentLogDetails = Record<string, unknown>;

function errorDetails(error: unknown): unknown {
    if (!(error instanceof Error)) return { type: typeof error };
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
    };
}

export function paymentLogInfo(
    event: string,
    details: PaymentLogDetails,
): void {
    console.info(`[payments] ${event}`, details);
}

export function paymentLogWarn(
    event: string,
    details: PaymentLogDetails,
): void {
    console.warn(`[payments] ${event}`, details);
}

export function paymentLogError(
    event: string,
    details: PaymentLogDetails,
    error?: unknown,
): void {
    console.error(`[payments] ${event}`, {
        ...details,
        ...(error === undefined ? {} : { error: errorDetails(error) }),
    });
}
