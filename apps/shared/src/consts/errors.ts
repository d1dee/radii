/**
 * Unified API error contract.
 *
 * Every FAILED API response — including form/validation errors — shares one
 * envelope, so clients never need separate handling for "regular" errors and
 * form errors:
 *
 *     {
 *         success: false,
 *         message: string,     // human-readable reason, safe to show users
 *         type: ApiErrorType,  // one of the CAPS constants below
 *         data?: object        // OPTIONAL extra context (see below)
 *     }
 *
 * Successful responses keep the existing shape: `{ success: true, data?: T }`.
 *
 * `data` is an escape hatch for structured context the frontend genuinely
 * cannot derive from `type` + `message` (the canonical example is per-field
 * form errors under `data.fieldErrors`). Avoid adding to it: prefer encoding
 * meaning in `type` and keeping details in `message`.
 */

export const ApiErrorType = {
    /**
     * The request payload failed validation. Responses of this type may carry
     * `data.fieldErrors` (see FieldErrorsData). HTTP 400.
     */
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    /** Missing or invalid session — the client is not authenticated. HTTP 401. */
    UNAUTHORIZED: 'UNAUTHORIZED',
    /** Authenticated, but not allowed (e.g. admin role required). HTTP 403. */
    FORBIDDEN: 'FORBIDDEN',
    /** The requested resource does not exist. HTTP 404. */
    NOT_FOUND: 'NOT_FOUND',
    /**
     * The request conflicts with current server state, e.g. registering a
     * phone number that is already registered. May also carry
     * `data.fieldErrors` to point the error at a specific form field. HTTP 409.
     */
    CONFLICT: 'CONFLICT',
    /** Unexpected server-side failure. HTTP 5xx. */
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    /**
     * Generated client-side only (never returned by the server): the server
     * could not be reached or its response could not be parsed.
     */
    NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export type ApiErrorType = (typeof ApiErrorType)[keyof typeof ApiErrorType];

/**
 * Optional `data` payload attached to failed responses when individual form
 * fields should be flagged. Keys are form field names; values are the
 * messages to show under each field.
 */
export type FieldErrorsData = {
    fieldErrors: Record<string, string>;
};

/** The failure half of the API envelope. */
export type ApiEnvelopeError = {
    success: false;
    /** Human-readable reason; always present and safe to display. */
    message: string;
    /** Machine-readable category from ApiErrorType. */
    type: ApiErrorType;
    /** Optional structured context (e.g. FieldErrorsData). Use sparingly. */
    data?: Record<string, unknown>;
};

/** The success half of the API envelope. */
export type ApiEnvelopeSuccess<T = unknown> = {
    success: true;
    data?: T;
};

/** Envelope shared by every REST endpoint and every client request helper. */
export type ApiEnvelope<T = unknown> =
    | ApiEnvelopeError
    | ApiEnvelopeSuccess<T>;

/**
 * Type guard for failed envelopes carrying per-field form errors.
 *
 * Note: check `hasFieldErrors(result.data)`, not `result.type` — field
 * errors can accompany CONFLICT (duplicate phone number) or UNAUTHORIZED
 * (bad credentials) responses too, not just VALIDATION_ERROR.
 */
export function hasFieldErrors(data: unknown): data is FieldErrorsData {
    if (typeof data !== 'object' || data === null) return false;
    const fieldErrors = (data as FieldErrorsData).fieldErrors;
    return (
        typeof fieldErrors === 'object' &&
        fieldErrors !== null &&
        !Array.isArray(fieldErrors)
    );
}
