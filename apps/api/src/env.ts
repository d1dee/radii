// Centralized environment access. Validates required variables at startup so
// the server fails fast with a clear message instead of crashing mid-request.

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing required environment variable: ${name}`);
        process.exit(1);
    }
    return value;
}

export const env = {
    apiUrl: required('API_URL'),
    adminFrontendUrls: (process.env.ADMIN_FRONTEND_URLS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    frontendUrls: (process.env.FRONTEND_URLS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    databaseUrl: required('DATABASE_URL'),
    // NAS setup-script generation (all optional, defaults applied in the
    // generator). RADIUS_SERVER/WG_* values are substituted into the
    // RouterOS template rendered for each NAS device.

    hotspotPortalUrl: required('HOTSPOT_PORTAL_URL'),
    // Public PPPoE self-service portal used by the expired-subscriber walled
    // garden. A stable address avoids depending on DNS when redirecting HTTP;
    // when omitted, the generated RouterOS script resolves the portal host.
    pppoePortalUrl: process.env.PPPOE_PORTAL_URL || '',
    pppoePortalIp: process.env.PPPOE_PORTAL_IP || '',
    pppoeExpiredRateLimit:
        process.env.PPPOE_EXPIRED_RATE_LIMIT || '512k/512k',
    ntpServers: process.env.NTP_SERVERS || '0.pool.ntp.org,1.pool.ntp.org',
    wgManagementSubnet: process.env.WG_MANAGEMENT_SUBNET || '10.99.0.0/16',
    // The radii server's own WireGuard interface address inside
    // wgManagementSubnet. Each NAS peer's allowed-address is narrowed to
    // this single IP (/32) so a NAS tunnel can only reach the management
    // interface, never another NAS (1:1 isolation).
    wgInterfaceIp: process.env.WG_INTERFACE_IP || '',
    wgServerPublicKey: process.env.WG_SERVER_PUBLIC_KEY || '',
    wgEndpoint: process.env.WG_ENDPOINT || '',
    wgListenPort: parseInt(process.env.WG_LISTEN_PORT || '51820', 10),
    // Server-side WireGuard peer management. When enabled the API keeps the
    // peers on WG_IFACE in sync with the database (incremental `wg set` —
    // existing tunnels are never disturbed) using the `wg` CLI (WG_BIN),
    // which requires CAP_NET_ADMIN. With WG_USE_SUDO=true the privileged
    // subcommands (set/syncconf) run via `sudo -n` instead, relying on a
    // NOPASSWD sudoers entry rather than ambient capabilities.
    wgManagePeers:
        (process.env.WG_MANAGE_PEERS || '').trim().toLowerCase() === 'true',
    wgIface: process.env.WG_IFACE || 'wg0',
    wgBin: process.env.WG_BIN || 'wg',
    wgUseSudo: (process.env.WG_USE_SUDO || '').trim().toLowerCase() === 'true',
    // RADIUS integration (backend <-> FreeRADIUS + NAS). All optional: with
    // nothing set, package provisioning still writes the FreeRADIUS SQL tables
    // (radcheck/radreply), but direct RADIUS packets (credential checks) are
    // disabled with a clear error.
    //
    // RADIUS_URL points at the RADIUS server, e.g. "radius://127.0.0.1" or
    // "radius://10.99.0.1:1812" (scheme optional; auth port defaults to 1812).
    // RADIUS_SECRET is the shared secret registered for THIS api as a RADIUS
    // client on that server (FreeRADIUS clients.conf / nas table) and signs
    // the Access-Requests the api originates.
    //
    // Session termination (Disconnect-Request) and re-authorization
    // (CoA-Request) are sent DIRECTLY to the NAS on its `/radius/incoming`
    // listener (RADIUS_DM_PORT, RouterOS default 1700), identified by
    // Acct-Session-Id + User-Name and signed with the per-NAS shared secret
    // stored in nas_setup_script; the NAS is resolved from the session's
    // NAS-IP-Address.
    radius: {
        radiusServer: required('RADIUS_SERVER'),
        url: process.env.RADIUS_URL || '',
        secret: process.env.RADIUS_SECRET || '',
        acctPort: parseInt(process.env.RADIUS_ACCT_PORT || '1813', 10),
        dmPort: parseInt(process.env.RADIUS_DM_PORT || '1700', 10),
        timeoutMs: parseInt(process.env.RADIUS_TIMEOUT_MS || '2000', 10),
        retries: parseInt(process.env.RADIUS_RETRIES || '2', 10),
        // Cumulative time-bank (noExpiry) packages: how often the reconciler
        // recomputes bank balances (pushing CoA Session-Timeout caps to live
        // sessions and cutting exhausted ones), and the Acct-Interim-Interval
        // requested from the NAS so accounting counters stay fresh.
        bankReconcileSeconds: parseInt(
            process.env.RADIUS_BANK_RECONCILE_SECONDS || '60',
            10,
        ),
        bankInterimSeconds: parseInt(
            process.env.RADIUS_BANK_INTERIM_SECONDS || '60',
            10,
        ),
    },
    // PPPoE portal dialer configuration handed to customers configuring their
    // PPPoE client (router/phone dialer). All optional; sane defaults apply.
    // An empty service name means the NAS PPPoE server accepts any service.
    // MTU/MRU default to 1480 per the RouterOS manual guidance (underlying
    // 1500-byte Ethernet MTU reduced by 20 to avoid fragmentation).
    pppoe: {
        serviceName: process.env.PPPOE_SERVICE_NAME || '',
        mtu: parseInt(process.env.PPPOE_MTU || '1480', 10),
        mru: parseInt(process.env.PPPOE_MRU || '1480', 10),
        dns: (process.env.PPPOE_DNS || '1.1.1.1,8.8.8.8')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    },
    // M-Pesa payment provider credentials. All optional here: when nothing is
    // set the provider simply is not registered; when partially set, the
    // provider constructor validates and fails fast with a clear message.
    mpesa: {
        consumerKey: process.env.MPESA_CONSUMER_KEY || '',
        consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
        shortcode: process.env.MPESA_SHORTCODE || '',
        tillNumber: process.env.MPESA_TILL_NUMBER || '',
        passkey: process.env.MPESA_PASSKEY || '',
        environment: (process.env.MPESA_ENVIRONMENT === 'production'
            ? 'production'
            : 'sandbox') as 'production' | 'sandbox',
        initiatorName: process.env.MPESA_INITIATOR_NAME || '',
        initiatorPassword: process.env.MPESA_INITIATOR_PASSWORD || '',
        certificatePath: process.env.MPESA_CERTIFICATE_PATH || '',
        transactionType: (process.env.MPESA_TRANSACTION_TYPE ||
            'CustomerPayBillOnline') as
            | 'CustomerPayBillOnline'
            | 'CustomerBuyGoodsOnline',
    },
    // Admin-console transactional email (Resend HTTP API). Optional: without
    // RESEND_API_KEY the admin verification codes are printed to the server
    // console instead (dev fallback). Only the admin BetterAuth instance
    // sends email; portal customers authenticate with phone+PIN only.
    resend: {
        apiKey: process.env.RESEND_API_KEY || '',
        from: process.env.RESEND_FROM || 'Radii Admin <onboarding@resend.dev>',
    },
};
