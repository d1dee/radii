// Backend for the FreeRADIUS `rest` module (raddb/mods-available/rest — the
// deployment copy lives in docs/radius/rest). rlm_rest pre-checks the
// configured connect_uri while FreeRADIUS initializes (refusing to start when
// it is unreachable) and then expands per-section requests into
// /user/%{User-Name}/nas/%{NAS-IP-Address}/mac/%{Called-Station-ID}?action=<section>.
//
// authorize answers with the session's Access-Accept attributes in rlm_rest
// JSON form: list-qualified attribute names (reply:<attribute> — FreeRADIUS
// 3.x syntax; 4.x uses reply.<attribute>) mapping either directly to a value
// or to { op, value } objects. 2xx bodies are parsed into pairs ("updated"),
// 204 means ok-without-attributes, and 401/403/404/410/5xx map to the
// module's reject/userlock/notfound/fail codes.
//
// Authentication of the ENDPOINT ITSELF (not of the RADIUS user) is a shared
// secret: every per-request callback must carry `x-api-key:
// <RADIUS_REST_API_KEY>` (env; injected by FreeRADIUS through
// control:REST-HTTP-Header — see docs/radius/rest for the module config and
// call sites). RADIUS user credentials live in radcheck and are verified by
// FreeRADIUS itself through the SQL module (pap); this endpoint only answers
// the startup health check, the authorize query, and the post-auth
// notification.
//
// All per-request callbacks are POST-only: `authorize` mutates state
// (time-bank reconciliation, CoA/Disconnect-Request to routers) and answers
// with full Access-Accept attributes, so a GET-reachable callback would let
// anyone replay authorizations; GET on the callback path returns 405.

import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { env } from '../env';
import { jsonError } from '../lib/error';
import { radiusClient } from '../lib/radius';
import { apiLogger } from '../logging';
import type { AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();
const logger = apiLogger.getChild('radius').getChild('rest');

// --- Shared-secret authentication -------------------------------------------
// Comparison runs over sha256 digests with timingSafeEqual (same pattern as
// the NAS bootstrap tokens in lib/setupScript.ts) so neither key length nor
// prefix-match timing leaks. A missing/wrong key answers the standard 401
// envelope, which rlm_rest maps to its `reject` module code — a
// misconfigured key fails CLOSED (all RADIUS auth rejected), never open.
//
// The health endpoints below are deliberately NOT key-protected: rlm_rest
// pre-caches connect_uri at module instantiation, before any request
// context exists, so that warm-up can never carry the header. They answer
// with static status JSON only.
function apiKeyMatches(provided: string): boolean {
    const presented = createHash('sha256').update(provided).digest();
    const expected = createHash('sha256')
        .update(env.radiusRestApiKey)
        .digest();
    return timingSafeEqual(presented, expected);
}

app.use('/user/*', async (c, next) => {
    const provided = c.req.header('x-api-key') ?? '';
    if (!provided || !apiKeyMatches(provided)) {
        logger.warn('Rejected rlm_rest request without a valid x-api-key', {
            method: c.req.method,
            path: c.req.path,
        });
        return jsonError(c, 401, 'Unauthorized: invalid or missing x-api-key');
    }
    await next();
});

// --- Health check -----------------------------------------------------------
// FreeRADIUS probes connect_uri on module initialization; the bare prefix and
// an explicit /health both answer for reachability checks and monitoring.

app.get('/', (c) => c.json({ status: 'ok' }));
app.get('/health', (c) => c.json({ status: 'ok' }));

// --- Per-request callbacks ----------------------------------------------------
// rlm_rest expands User-Name and Called-Station-ID into the path and selects
// the virtual-server section via the `action` query parameter (FreeRADIUS v4
// builds the same requests with `section=` instead — accept both). The
// /nas/%{NAS-IP-Address} path segment is REQUIRED: it identifies the
// requesting NAS so authorizations can be restricted to the tenant that owns
// the device (and CoA/Disconnect packets can be routed back to it).
const CALLBACK_PATH = '/user/:userName/nas/:nasIpAddress/mac/:calledStationId';

// Method hardening: every action behind this route either mutates state
// (authorize, post-auth) or must never be served over GET (authenticate is a
// stub deferring to the SQL module), so POST is the only accepted method and
// GET answers 405. rlm_rest maps 405 to `invalid` -> fail (closed).
app.get(CALLBACK_PATH, (c) => {
    c.header('Allow', 'POST');
    return jsonError(c, 405, 'Method not allowed: use POST');
});

app.post(CALLBACK_PATH, async (c) => {
    const action = (
        c.req.query('action') ??
        c.req.query('section') ??
        ''
    ).toLowerCase();
    const userName = c.req.param('userName');
    const nasIpAddress = c.req.param('nasIpAddress');
    const calledStationId = c.req.param('calledStationId');

    switch (action) {
        case 'authorize': {
            // 200 + attribute JSON -> rlm_rest "updated": the pairs are added
            // to the request. Rejections map to 403/404 status codes, which
            // rlm_rest translates to its userlock/notfound module codes.
            const verdict = await radiusClient.restAuthorize(
                userName,
                nasIpAddress,
            );
            switch (verdict.verdict) {
                case 'unknown':
                    return jsonError(c, 404, 'User not found');
                case 'expired':
                    return jsonError(c, 403, 'Package validity expired');
                case 'deactivated':
                    return jsonError(c, 403, 'Package deactivated');
                case 'exhausted':
                    return jsonError(c, 403, 'Time bank exhausted');
                case 'restricted':
                    return c.json(verdict.attributes);
                default:
                    return c.json(verdict.attributes);
            }
        }
        case 'authenticate':
            // freeradius-sql (pap over radcheck) owns authentication; this
            // endpoint never verifies credentials.
            return jsonError(
                c,
                404,
                'Authentication is handled by the FreeRADIUS SQL module',
            );
        case 'post-auth':
            // Login succeeded at the RADIUS server. radpostauth itself is
            // written by the SQL module; this is the API-side audit trail.
            logger.info('RADIUS post-authentication succeeded', {
                nasIpAddress,
            });
            return c.body(null, 204);
        default:
            return action
                ? jsonError(
                      c,
                      404,
                      `Unsupported rlm_rest action: ${action}`,
                  )
                : jsonError(c, 400, 'Missing action query parameter');
    }
});

export default app;
