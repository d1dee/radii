import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppContext } from '../types';

// Uniform JSON error response used across route handlers.
export function jsonError(
    c: AppContext,
    status: ContentfulStatusCode,
    message: string,
) {
    return c.json({ success: false, error: message }, status);
}

// Validation error response carrying per-field messages. The client maps
// these straight onto its form errors.
export function jsonFieldErrors(
    c: AppContext,
    status: ContentfulStatusCode,
    fieldErrors: Record<string, string>,
) {
    return c.json({ success: false, fieldErrors }, status);
}
