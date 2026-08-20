// Centralized environment access. Validates required variables at startup so
// the server fails fast with a clear message instead of crashing mid-request.

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

export const env = {
    baseUrl: required('BASE_URL'),
    port: parseInt(required('PORT'), 10),
    frontendUrls: (process.env.FRONTEND_URLS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    // NAS setup-script generation (all optional, defaults applied in the
    // generator). RADIUS_SERVER/WG_* values are substituted into the
    // RouterOS template rendered for each NAS device.
    radiusServer: process.env.RADIUS_SERVER || '',
    portalUrl: process.env.PORTAL_URL || '',
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
    wgUseSudo:
        (process.env.WG_USE_SUDO || '').trim().toLowerCase() === 'true',
};
