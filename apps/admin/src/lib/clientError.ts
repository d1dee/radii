import { ApiErrorType, type ApiEnvelope } from '@shared/index';

import { adminLogger } from '@/lib/logging';

type ErrorKind = 'aborted' | 'network' | 'unexpected';
const expectedErrorTypes = new Set<string>([
    ApiErrorType.VALIDATION_ERROR,
    ApiErrorType.UNAUTHORIZED,
    ApiErrorType.FORBIDDEN,
    ApiErrorType.NOT_FOUND,
]);

function classifyError(error: unknown): {
    errorKind: ErrorKind;
    errorName: string;
} {
    if (error instanceof DOMException && error.name === 'AbortError') {
        return { errorKind: 'aborted', errorName: error.name };
    }
    if (error instanceof TypeError) {
        return { errorKind: 'network', errorName: error.name };
    }
    return {
        errorKind: 'unexpected',
        errorName: error instanceof Error ? error.name : typeof error,
    };
}

export function reportClientError(
    error: unknown,
    operation: string,
    fallbackMessage: string,
): string {
    const diagnostic = classifyError(error);
    adminLogger.error('Unexpected client operation failure', {
        operation,
        ...diagnostic,
    });

    return diagnostic.errorKind === 'network'
        ? 'Could not reach the server. Check your connection and try again.'
        : fallbackMessage;
}

export function warnBackgroundFailure<T>(
    operation: string,
    result: ApiEnvelope<T>,
): void {
    if (!result.success && expectedErrorTypes.has(result.type)) return;
    adminLogger.warning('Background load failed', {
        operation,
        errorType: result.success ? 'MISSING_DATA' : result.type,
    });
}

export function getErrorDiagnostic(error: unknown): {
    errorKind: ErrorKind;
    errorName: string;
} {
    return classifyError(error);
}
