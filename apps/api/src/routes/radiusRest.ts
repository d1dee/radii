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
// Authentication is deliberately NOT implemented here: credentials live in
// radcheck and are verified by FreeRADIUS itself through the SQL module
// (pap). This endpoint only answers the startup health check, the authorize
// query, and the post-auth notification.

import { Hono } from 'hono';
import { jsonError } from '../lib/error';
import { radiusClient } from '../lib/radius';
import { apiLogger } from '../logging';
import type { AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();
const logger = apiLogger.getChild('radius').getChild('rest');

// --- Health check -----------------------------------------------------------
// FreeRADIUS probes connect_uri on module initialization; the bare prefix and
// an explicit /health both answer for reachability checks and monitoring.

app.get('/', (c) => c.json({ status: 'ok' }));
app.get('/health', (c) => c.json({ status: 'ok' }));

// --- Per-request callbacks ----------------------------------------------------
// rlm_rest expands User-Name and Called-Station-ID into the path and selects
// the virtual-server section via the `action` query parameter (FreeRADIUS v4
// builds the same requests with `section=` instead — accept both).

app.on(
    ['GET', 'POST'],
    '/user/:userName/nas/:nasIpAddress/mac/:calledStationId',
    async (c) => {
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
    },
);

export default app;
