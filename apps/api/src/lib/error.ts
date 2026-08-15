import { ApiErrorType } from '@radii/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppContext } from '../types';

// Derive the standard ApiErrorType from the HTTP status so callers only need
// to override it when the semantics differ from the status code.
function errorTypeForStatus(status: ContentfulStatusCode): ApiErrorType {
    switch (status) {
        case 400:
            return ApiErrorType.VALIDATION_ERROR;
        case 401:
            return ApiErrorType.UNAUTHORIZED;
        case 403:
            return ApiErrorType.FORBIDDEN;
        case 404:
            return ApiErrorType.NOT_FOUND;
        case 409:
            return ApiErrorType.CONFLICT;
        default:
            return ApiErrorType.INTERNAL_ERROR;
    }
}

// Uniform JSON error envelope used across route handlers:
// { success: false, message, type, data? } — see ApiEnvelope in @radii/shared.
export function jsonError(
    c: AppContext,
    status: ContentfulStatusCode,
    message: string,
    type: ApiErrorType = errorTypeForStatus(status),
    data?: Record<string, unknown>,
) {
    return c.json(
        data === undefined
            ? { success: false, message, type }
            : { success: false, message, type, data },
        status,
    );
}

// Error response carrying per-field messages under `data.fieldErrors`. The
// client maps these straight onto its form errors. The type still derives
// from the status (e.g. CONFLICT for a duplicate phone number) so clients
// can branch on either `type` or the presence of field errors.
export function jsonFieldErrors(
    c: AppContext,
    status: ContentfulStatusCode,
    fieldErrors: Record<string, string>,
    message = 'Validation failed',
) {
    return jsonError(c, status, message, errorTypeForStatus(status), {
        fieldErrors,
    });
}
