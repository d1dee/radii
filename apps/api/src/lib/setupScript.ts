import type { GenerateSetupScriptInput } from '@radii/shared';
import { desc, eq } from 'drizzle-orm';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '../db';
import { nas, nasDevice, nasSetupScript } from '../db/schema';
import { env } from '../env';
import { apiLogger } from '../logging';
import type { NasDeviceRow } from './nas';
import {
    renderMikrotikSetupScript,
    sanitizeRosComment,
} from './setupScriptTemplate';
import { removePeer, wgManagementEnabled } from './wireguard';

const logger = apiLogger.getChild('wireguard');

export class SetupScriptConfigError extends Error {}

// How long a freshly generated bootstrap token stays usable for
// GET /api/nas/:id/script and POST /api/nas/:id/report. After the first
// successful report the token is consumed immediately (one-shot); the TTL
// only bounds the never-used case.
export const BOOTSTRAP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

// Rejection sampling: bytes >= limit would make the first (256 % n)
// characters of the alphabet more likely (modulo bias), so they are
// discarded and redrawn until every character is uniformly probable.
function randomToken(length: number): string {
    const limit = 256 - (256 % TOKEN_CHARS.length);
    const out: string[] = [];
    while (out.length < length) {
        const bytes = new Uint8Array(length * 2);
        crypto.getRandomValues(bytes);
        for (const byte of bytes) {
            if (byte >= limit) continue;
            out.push(TOKEN_CHARS[byte % TOKEN_CHARS.length]!);
            if (out.length === length) break;
        }
    }
    return out.join('');
}

function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

// Recoverable by the server without storing plaintext; device credentials
// alone cannot derive the capability. The expiry changes on each rotation.
function deriveBootstrapToken(
    deviceId: string,
    radiusSecret: string,
    expiresAt: Date,
): string {
    return createHmac('sha256', env.adminBetterAuthSecret)
        .update(
            JSON.stringify([
                'radii-nas-bootstrap-v1',
                deviceId,
                radiusSecret,
                expiresAt.toISOString(),
            ]),
        )
        .digest('hex');
}

// Tokens are stored only as sha256 hex digests; comparisons run over the
// fixed-length digests with timingSafeEqual so token checks never leak
// prefix-match timing.
export function hashNasToken(token: string): string {
    return sha256Hex(token);
}

export function nasTokenMatchesHash(
    token: string,
    expectedHash: string,
): boolean {
    const presented = Buffer.from(sha256Hex(token), 'utf8');
    const expected = Buffer.from(expectedHash, 'utf8');
    if (presented.length !== expected.length) return false;
    return timingSafeEqual(presented, expected);
}

// The page token (GET /api/nas/:id/hotspot/:page — branded HTML only, no
// secrets) is derived deterministically from the bootstrap token so the
// /script route can embed it at serve time without either plaintext being
// persisted. Observing the page token does not reveal the bootstrap token
// (sha256 preimage resistance).
const PAGE_TOKEN_PREFIX = 'radii-nas-page-token:';

export function deriveNasPageToken(bootstrapToken: string): string {
    return sha256Hex(PAGE_TOKEN_PREFIX + bootstrapToken);
}

// Fills the token placeholders deliberately left in the stored script with
// the live bootstrap token and its derived page token. Only call after the
// presented token has been verified against bootstrapTokenHash.
export function substituteNasScriptTokens(
    script: string,
    bootstrapToken: string,
): string {
    return script
        .split('{{BOOTSTRAP_TOKEN}}')
        .join(bootstrapToken)
        .split('{{PAGE_TOKEN}}')
        .join(deriveNasPageToken(bootstrapToken));
}

function randomBase64(byteLength: number): string {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString('base64');
}

function parseIpv4(ip: string): number {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (
        parts.length !== 4 ||
        parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)
    ) {
        throw new SetupScriptConfigError(`Invalid IPv4 address: ${ip}`);
    }
    return (
        ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
    );
}

function formatIpv4(value: number): string {
    return [
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
    ].join('.');
}

interface Ipv4Subnet {
    network: number;
    broadcast: number;
    prefixLen: number;
}

function parseIpv4Cidr(cidr: string): Ipv4Subnet {
    const [ip, prefix] = cidr.split('/');
    const prefixLen = parseInt(prefix, 10);
    if (Number.isNaN(prefixLen) || prefixLen < 8 || prefixLen > 30) {
        throw new SetupScriptConfigError(
            `Subnet prefix must be between /8 and /30: ${cidr}`,
        );
    }
    const mask = (~0 << (32 - prefixLen)) >>> 0;
    const network = (parseIpv4(ip) & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    return { network, broadcast, prefixLen };
}

function ipv4NetworkInfo(cidr: string, label: string) {
    const { network, broadcast, prefixLen } = parseIpv4Cidr(cidr);
    if (broadcast - network < 4) {
        throw new SetupScriptConfigError(
            `${label} network must contain at least 4 usable addresses`,
        );
    }
    const gateway = formatIpv4(network + 1);
    return {
        gateway,
        address: `${gateway}/${prefixLen}`,
        pool: `${formatIpv4(network + 2)}-${formatIpv4(broadcast - 1)}`,
        prefixLen,
        network: formatIpv4(network),
    };
}

function randomInt(maxExclusive: number): number {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return bytes[0] % maxExclusive;
}

// Allocates a unique WireGuard client address for this device, picked at
// random from the management subnet (configure a wide range such as a /16).
// The address is what the radii server later uses to reach the NAS over the
// tunnel (API/Web). Addresses already used by other devices are skipped.
async function allocateWgClientIp(
    subnetCidr: string,
    nasDeviceId: string,
    reservedIp?: string,
): Promise<string> {
    const { network, broadcast } = parseIpv4Cidr(subnetCidr);
    const rows = await db
        .select({
            wgClientIp: nasSetupScript.wgClientIp,
            nasDeviceId: nasSetupScript.nasDeviceId,
        })
        .from(nasSetupScript);
    const used = new Set<number>();
    // Reserve .0 (network), .1 (gateway/server) and broadcast.
    used.add(network);
    used.add(network + 1);
    used.add(broadcast);
    if (reservedIp) used.add(parseIpv4(reservedIp));
    for (const row of rows) {
        if (row.nasDeviceId === nasDeviceId) continue;
        used.add(parseIpv4(row.wgClientIp));
    }

    const first = network + 2;
    const last = broadcast - 1;
    const span = last - first + 1;
    if (span <= 0) {
        throw new SetupScriptConfigError(
            `WireGuard subnet ${subnetCidr} is too small`,
        );
    }

    // Probe from a random offset so each NAS gets an unpredictable address.
    const start = randomInt(span);
    for (let offset = 0; offset < span; offset++) {
        const addr = first + ((start + offset) % span);
        if (!used.has(addr)) return formatIpv4(addr);
    }
    throw new SetupScriptConfigError(
        `No free WireGuard addresses left in ${subnetCidr}`,
    );
}

function parseWgEndpoint(endpoint: string): { host: string; port: number } {
    const [host, port] = endpoint.trim().split(':');
    if (!host) {
        throw new SetupScriptConfigError(
            `Invalid WireGuard endpoint: ${endpoint}`,
        );
    }
    const portNum = port ? parseInt(port, 10) : 51820;
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
        throw new SetupScriptConfigError(
            `Invalid WireGuard endpoint port: ${endpoint}`,
        );
    }
    return { host, port: portNum };
}

export function buildBootstrapScript(
    deviceId: string,
    bootstrapToken: string,
    apiBase: string,
): string {
    const url = `${apiBase}/api/nas/${deviceId}/script?token=${bootstrapToken}`;
    return `/tool fetch url="${url}" dst-path=radii-setup.rsc; /import radii-setup.rsc`;
}

export async function generateSetupScript(
    device: NasDeviceRow,
    input: GenerateSetupScriptInput,
) {
    const apiDomain = new URL(env.apiUrl).hostname;
    const hotspotPortalUrl = env.hotspotPortalUrl.replace(/\/+$/, '');
    const portalDomain = new URL(hotspotPortalUrl).hostname;
    const pppoePortalUrl = env.pppoePortalUrl.replace(/\/+$/, '');
    if (!pppoePortalUrl) {
        throw new SetupScriptConfigError(
            'PPPoE portal is not configured. Set PPPOE_PORTAL_URL before generating setup scripts.',
        );
    }
    const pppoePortal = new URL(pppoePortalUrl);
    if (!['http:', 'https:'].includes(pppoePortal.protocol)) {
        throw new SetupScriptConfigError(
            'PPPOE_PORTAL_URL must use http:// or https://.',
        );
    }
    const pppoePortalDomain = pppoePortal.hostname;
    const pppoePortalIp = env.pppoePortalIp.trim();
    if (pppoePortalIp) parseIpv4(pppoePortalIp);
    if (!/^\d+[kM]?\/\d+[kM]?$/.test(env.pppoeExpiredRateLimit)) {
        throw new SetupScriptConfigError(
            'PPPOE_EXPIRED_RATE_LIMIT must use RouterOS rx/tx format, e.g. 512k/512k.',
        );
    }
    const pppoeRedirectPort =
        pppoePortal.protocol === 'http:'
            ? parseInt(pppoePortal.port || '80', 10)
            : 80;
    const pppoePortalPort = parseInt(
        pppoePortal.port || (pppoePortal.protocol === 'https:' ? '443' : '80'),
        10,
    );
    const allowedPppoePorts = new Set([
        80,
        443,
        pppoeRedirectPort,
        pppoePortalPort,
        parseInt(
            new URL(env.apiUrl).port ||
                (env.apiUrl.startsWith('https:') ? '443' : '80'),
            10,
        ),
    ]);

    const radiusServer = env.radius.radiusServer;
    if (!env.wgServerPublicKey || !env.wgEndpoint) {
        throw new SetupScriptConfigError(
            'WireGuard server is not configured. Set WG_SERVER_PUBLIC_KEY and WG_ENDPOINT before generating setup scripts.',
        );
    }

    const hs = ipv4NetworkInfo(input.hotspotNetwork, 'Hotspot');
    const pppoe = ipv4NetworkInfo(input.pppoeNetwork, 'PPPoE');
    const wg = parseWgEndpoint(env.wgEndpoint);
    const wgSubnet = parseIpv4Cidr(env.wgManagementSubnet);
    const wgInterfaceIp = env.wgInterfaceIp.trim();
    if (!wgInterfaceIp) {
        throw new SetupScriptConfigError(
            'WireGuard server interface IP is not configured. Set WG_INTERFACE_IP (the radii server WireGuard interface address inside WG_MANAGEMENT_SUBNET) before generating setup scripts.',
        );
    }
    const wgInterfaceNum = parseIpv4(wgInterfaceIp);
    if (
        wgInterfaceNum <= wgSubnet.network ||
        wgInterfaceNum >= wgSubnet.broadcast
    ) {
        throw new SetupScriptConfigError(
            `WG_INTERFACE_IP (${wgInterfaceIp}) must be inside the management subnet ${env.wgManagementSubnet}`,
        );
    }
    const wgClientIp = await allocateWgClientIp(
        env.wgManagementSubnet,
        device.id,
        wgInterfaceIp,
    );
    const hotspotDnsName = input.hotspotDnsName || `hotspot.radii.lan`;
    const brandName = input.brandName || device.name;

    const radiusSecret = randomToken(24);
    const wgPsk = randomBase64(32);
    // Only token hashes and the expiry are persisted.
    const bootstrapExpiresAt = new Date(Date.now() + BOOTSTRAP_TOKEN_TTL_MS);
    const bootstrapToken = deriveBootstrapToken(
        device.id, radiusSecret, bootstrapExpiresAt,
    );
    const bootstrapTokenHash = hashNasToken(bootstrapToken);
    const pageTokenHash = hashNasToken(deriveNasPageToken(bootstrapToken));
    const wgServerPublicKey = env.wgServerPublicKey.trim();
    const reportUrl = `${env.apiUrl}/api/nas/${device.id}/report`;

    const { script, pages } = renderMikrotikSetupScript(
            {
            NAS_ID: device.id,
            NAS_NAME: device.name,
            NAS_IDENTITY:
                device.name.replace(/[^a-zA-Z0-9 ._-]/g, '').slice(0, 14) ||
                (device.model ?? 'radii').slice(0, 14),
            NAS_MODEL: device.model ?? 'auto-detected',
            NAS_SERIAL: device.serialNumber ?? 'auto-detected',
            NAS_LOCATION: device.location || '-',
            GENERATED_AT: new Date().toISOString(),
            RADIUS_SERVER: radiusServer,
            RADIUS_SECRET: radiusSecret,
            WG_LISTEN_PORT: String(env.wgListenPort),
            WG_CLIENT_IP: wgClientIp,
            WG_PREFIX_LEN: String(wgSubnet.prefixLen),
            WG_ENDPOINT_HOST: wg.host,
            WG_ENDPOINT_PORT: String(wg.port),
            WG_SERVER_PUBLIC_KEY: wgServerPublicKey,
            WG_PSK: wgPsk,
            WG_ALLOWED_ADDRESS: `${wgInterfaceIp}/32`,
            NAS_REPORT_URL: reportUrl,
            HOTSPOT_INTERFACE: input.hotspotInterface,
            HOTSPOT_NETWORK: `${hs.network}/${hs.prefixLen}`,
            HOTSPOT_GATEWAY: hs.gateway,
            HOTSPOT_ADDRESS: hs.address,
            HOTSPOT_POOL: hs.pool,
            HOTSPOT_DNS_NAME: hotspotDnsName,
            SHARED_USERS: '1',
            PPP_INTERFACE: input.pppoeInterface,
            PPP_NETWORK: `${pppoe.network}/${pppoe.prefixLen}`,
            PPP_GATEWAY: pppoe.gateway,
            PPP_ADDRESS: pppoe.address,
            PPP_POOL: pppoe.pool,
            PPP_SERVICE_NAME: 'radii-pppoe',
            PPP_MTU: String(env.pppoe.mtu),
            PPP_MRU: String(env.pppoe.mru),
            PPP_INTERIM_UPDATE: `${env.radius.bankInterimSeconds}s`,
            PPP_EXPIRED_RATE_LIMIT: env.pppoeExpiredRateLimit,
            PPP_PORTAL_DOMAIN: pppoePortalDomain,
            PPP_PORTAL_DOMAIN_IS_IP: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(
                pppoePortalDomain,
            )
                ? '1'
                : '',
            PPP_PORTAL_IP: pppoePortalIp,
            PPP_PORTAL_REDIRECT_PORT: String(pppoeRedirectPort),
            PPP_PORTAL_ALLOWED_TCP_PORTS: Array.from(allowedPppoePorts)
                .sort((a, b) => a - b)
                .join(','),
            NTP_SERVERS: env.ntpServers,
            BRAND_NAME: brandName,
            PORTAL_URL: hotspotPortalUrl,
            PORTAL_DOMAIN: portalDomain,
            PORTAL_DOMAIN_IS_IP: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(
                portalDomain,
            )
                ? '1'
                : '',
            API_DOMAIN: apiDomain,
            API_DOMAIN_IS_IP: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(apiDomain)
                ? '1'
                : '',
                API_BASE_URL: env.apiUrl,
            },
            { ipLockdown: input.ipLockdown },
    );

    const [existing] = await db
        .select()
        .from(nasSetupScript)
        .where(eq(nasSetupScript.nasDeviceId, device.id))
        .limit(1);

    // Regenerating resets the peer identity: the device creates a fresh
    // keypair when it re-runs the script, so the previously reported key
    // becomes stale. Drop it from the interface now; the DB row below no
    // longer references it, so reconciliation would prune it anyway.
    if (existing?.wgPublicKey && wgManagementEnabled()) {
        try {
            await removePeer(existing.wgPublicKey);
        } catch (e) {
            logger.error('Failed to remove stale peer during setup regeneration', {
                nasDeviceId: device.id,
                error: e,
            });
        }
    }

    const [row] = await db.transaction(async (tx) => {
        // Remember the tunnel address on the device; it is how the radii
        // server reaches the NAS (API/Web) once the tunnel is up.
        await tx
            .update(nasDevice)
            .set({
                metadata: {
                    ...((device.metadata ?? {}) as Record<string, unknown>),
                    wgClientIp,
                },
            })
            .where(eq(nasDevice.id, device.id));

        // Register the device as a FreeRADIUS client so the secret above is
        // accepted for auth/accounting coming over the management tunnel.
        // RADIUS traffic always arrives via the WireGuard tunnel address,
        // not the user-entered `ipAddress` (which is identification only and
        // user-editable), so the FreeRADIUS `nasname` must be the tunnel IP.
        await tx.delete(nas).where(eq(nas.nasname, wgClientIp));
        await tx.insert(nas).values({
            nasname: wgClientIp,
            shortname: device.name,
            type: 'other',
            secret: radiusSecret,
            description: `radii managed (${device.serialNumber ?? device.id})`,
        });

        if (existing) {
            const [updated] = await tx
                .update(nasSetupScript)
                .set({
                    script,
                    hotspotPages: pages,
                    hotspotInterface: input.hotspotInterface,
                    hotspotNetwork: input.hotspotNetwork,
                    hotspotDnsName: input.hotspotDnsName ?? null,
                    brandName: input.brandName ?? null,
                    pppoeInterface: input.pppoeInterface,
                    pppoeNetwork: input.pppoeNetwork,
                    ipLockdown: input.ipLockdown,
                    wgPublicKey: null,
                    wgClientIp,
                    wgPsk,
                    radiusSecret,
                    bootstrapTokenHash,
                    bootstrapExpiresAt,
                    pageTokenHash,
                    wgKeyReportedAt: null,
                    status: 'pending',
                    generatedAt: new Date(),
                })
                .where(eq(nasSetupScript.id, existing.id))
                .returning();
            return [updated];
        }
        return tx
            .insert(nasSetupScript)
            .values({
                nasDeviceId: device.id,
                script,
                hotspotPages: pages,
                hotspotInterface: input.hotspotInterface,
                hotspotNetwork: input.hotspotNetwork,
                hotspotDnsName: input.hotspotDnsName ?? null,
                brandName: input.brandName ?? null,
                pppoeInterface: input.pppoeInterface,
                pppoeNetwork: input.pppoeNetwork,
                ipLockdown: input.ipLockdown,
                wgPublicKey: null,
                wgClientIp,
                wgPsk,
                radiusSecret,
                bootstrapTokenHash,
                bootstrapExpiresAt,
                pageTokenHash,
                wgKeyReportedAt: null,
                status: 'pending',
            })
            .returning();
    });

    return {
        ...row,
        // The capability is returned to the admin, never persisted in plaintext.
        bootstrapToken,
        script: buildBootstrapScript(device.id, bootstrapToken, env.apiUrl),
    };
}

export async function getNasBootstrapScript(nasDeviceId: string) {
    return db.transaction(async (tx) => {
        const [existing] = await tx
            .select()
            .from(nasSetupScript)
            .where(eq(nasSetupScript.nasDeviceId, nasDeviceId))
            .limit(1)
            .for('update');
        if (!existing) return null;

        let row = existing;
        let token = existing.bootstrapExpiresAt
            ? deriveBootstrapToken(
                nasDeviceId, existing.radiusSecret, existing.bootstrapExpiresAt,
            )
            : '';
        if (
            !existing.bootstrapExpiresAt ||
            existing.bootstrapExpiresAt.getTime() <= Date.now() ||
            !existing.bootstrapTokenHash ||
            !nasTokenMatchesHash(token, existing.bootstrapTokenHash)
        ) {
            // Legacy random tokens cannot be recovered and are rotated once.
            const expiresAt = new Date(Math.max(
                Date.now() + BOOTSTRAP_TOKEN_TTL_MS,
                (existing.bootstrapExpiresAt?.getTime() ?? 0) + 1,
            ));
            token = deriveBootstrapToken(
                nasDeviceId, existing.radiusSecret, expiresAt,
            );
            const [updated] = await tx
                .update(nasSetupScript)
                .set({
                    bootstrapTokenHash: hashNasToken(token),
                    bootstrapExpiresAt: expiresAt,
                })
                .where(eq(nasSetupScript.id, existing.id))
                .returning();
            row = updated!;
        }
        // Do not alter credentials, peer state, or the installed portal's page
        // token. The page token switches only when the router reports again.
        return {
            ...row,
            script: buildBootstrapScript(nasDeviceId, token, env.apiUrl),
        };
    });
}

export async function getSetupScriptForNasDevice(nasDeviceId: string) {
    const [row] = await db
        .select()
        .from(nasSetupScript)
        .where(eq(nasSetupScript.nasDeviceId, nasDeviceId))
        .orderBy(desc(nasSetupScript.generatedAt))
        .limit(1);
    return row;
}

// Device facts reported by the router when the setup script runs
// (WireGuard public key, model, serial, firmware version, ...).
export interface NasReport {
    publicKey: string;
    model?: string;
    serialNumber?: string;
    firmwareVersion?: string;
    boardName?: string;
    architecture?: string;
}

// Applies a router report: stores the WireGuard public key on the setup
// script row (the peering source of truth) and auto-fills the NAS device
// record with facts read from the device (model, serial number, firmware
// version).
export async function applyNasReport(
    scriptId: string,
    nasDeviceId: string,
    report: NasReport,
) {
    // Device-reported strings are attacker-influenced (a compromised router
    // reports arbitrary values) and are written back to the NAS row, where
    // they land in the NEXT generated script's comment header. Sanitize them
    // to the same safe charset used at render time so a poisoned report can
    // never inject RouterOS commands later.
    const cleanModel = report.model ? sanitizeRosComment(report.model) : '';
    const cleanSerial = report.serialNumber
        ? sanitizeRosComment(report.serialNumber)
        : '';
    const cleanVersion = report.firmwareVersion
        ? sanitizeRosComment(report.firmwareVersion)
        : '';
    const cleanBoard = report.boardName
        ? sanitizeRosComment(report.boardName)
        : '';
    const cleanArch = report.architecture
        ? sanitizeRosComment(report.architecture)
        : '';

    return db.transaction(async (tx) => {
        const [existing] = await tx
            .select()
            .from(nasSetupScript)
            .where(eq(nasSetupScript.id, scriptId))
            .limit(1);
        if (!existing) return null;

        const [row] = await tx
            .update(nasSetupScript)
            .set({
                wgPublicKey: report.publicKey,
                wgKeyReportedAt: new Date(),
            })
            .where(eq(nasSetupScript.id, scriptId))
            .returning();

        const [device] = await tx
            .select()
            .from(nasDevice)
            .where(eq(nasDevice.id, nasDeviceId))
            .limit(1);
        if (device) {
            const deviceUpdate: Record<string, unknown> = {
                metadata: {
                    ...((device.metadata ?? {}) as Record<string, unknown>),
                    ...(cleanBoard && { boardName: cleanBoard }),
                    ...(cleanArch && {
                        architecture: cleanArch,
                    }),
                },
            };
            if (cleanModel) deviceUpdate.model = cleanModel;
            if (cleanVersion) {
                // "/system resource get version" returns e.g. "7.16.2 (stable)".
                deviceUpdate.firmwareVersion = cleanVersion.split(' ')[0];
            }
            if (cleanSerial) {
                deviceUpdate.serialNumber = cleanSerial;
            }
            await tx
                .transaction(async (tx2) => {
                    await tx2
                        .update(nasDevice)
                        .set(deviceUpdate)
                        .where(eq(nasDevice.id, nasDeviceId));
                })
                .catch(async () => {
                    delete deviceUpdate.serialNumber;
                    await tx
                        .update(nasDevice)
                        .set(deviceUpdate)
                        .where(eq(nasDevice.id, nasDeviceId));
                });
        }
        return row;
    });
}
