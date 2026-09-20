import { apiLogger } from '../../logging';

type PaymentLogDetails = Record<string, unknown>;
const logger = apiLogger.getChild('payments');

export function paymentLogInfo(
    event: string,
    details: PaymentLogDetails,
): void {
    logger.info(event, details);
}

export function paymentLogWarn(
    event: string,
    details: PaymentLogDetails,
): void {
    logger.warn(event, details);
}

export function paymentLogError(
    event: string,
    details: PaymentLogDetails,
    error?: unknown,
): void {
    logger.error(event, {
        ...details,
        ...(error === undefined ? {} : { error }),
    });
}
