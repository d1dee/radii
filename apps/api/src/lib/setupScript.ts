import type { GenerateSetupScriptInput } from '@radii/shared';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { nas, nasDevice, nasSetupScript } from '../db/schema';
import { env } from '../env';
import type { NasDeviceRow } from './nas';
import { renderMikrotikSetupScript } from './setupScriptTemplate';
import { removePeer, wgManagementEnabled } from './wireguard';

export class SetupScriptConfigError extends Error {}

const TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomToken(length: number): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => TOKEN_CHARS[b % TOKEN_CHARS.length]).join(
        '',
    );
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

function hotspotNetworkInfo(cidr: string) {
    const { network, broadcast, prefixLen } = parseIpv4Cidr(cidr);
    if (broadcast - network < 4) {
        throw new SetupScriptConfigError(
            'Hotspot network must contain at least 4 usable addresses',
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
    registrationToken: string,
    apiBase: string,
): string {
    const url = `${apiBase}/api/nas/${deviceId}/script?token=${registrationToken}`;
    return `/tool fetch url="${url}" dst-path=radii-setup.rsc; /import radii-setup.rsc`;
}

export async function generateSetupScript(
    device: NasDeviceRow,
    input: GenerateSetupScriptInput,
) {
    const apiBase = env.baseUrl.replace(/\/+$/, '');
    const apiDomain = new URL(env.baseUrl).hostname;
    const portalUrl = (env.portalUrl || apiBase).replace(/\/+$/, '');
    const portalDomain = new URL(portalUrl).hostname;

    const radiusServer = env.radiusServer || apiDomain;
    if (!env.wgServerPublicKey || !env.wgEndpoint) {
        throw new SetupScriptConfigError(
            'WireGuard server is not configured. Set WG_SERVER_PUBLIC_KEY and WG_ENDPOINT before generating setup scripts.',
        );
    }

    const hs = hotspotNetworkInfo(input.hotspotNetwork);
    const wg = parseWgEndpoint(env.wgEndpoint);
    const wgSubnet = parseIpv4Cidr(env.wgManagementSubnet);
    const wgClientIp = await allocateWgClientIp(
        env.wgManagementSubnet,
        device.id,
    );
    const hotspotDnsName = input.hotspotDnsName || `hotspot.radii.lan`;
    const brandName = input.brandName || device.name;

    const radiusSecret = randomToken(24);
    const wgPsk = randomBase64(32);
    const registrationToken = randomToken(32);
    const wgServerPublicKey = env.wgServerPublicKey.trim();
    const reportUrl = `${apiBase}/api/nas/${device.id}/report`;

    const { script, pages } = renderMikrotikSetupScript({
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
        WG_ALLOWED_ADDRESS: env.wgManagementSubnet,
        NAS_REPORT_URL: reportUrl,
        REGISTRATION_TOKEN: registrationToken,
        HOTSPOT_INTERFACE: input.hotspotInterface,
        HOTSPOT_NETWORK: `${hs.network}/${hs.prefixLen}`,
        HOTSPOT_GATEWAY: hs.gateway,
        HOTSPOT_ADDRESS: hs.address,
        HOTSPOT_POOL: hs.pool,
        HOTSPOT_DNS_NAME: hotspotDnsName,
        SHARED_USERS: '1',
        NTP_SERVERS: env.ntpServers,
        BRAND_NAME: brandName,
        PORTAL_URL: portalUrl,
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
        API_BASE_URL: apiBase,
    });

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
            console.error(
                `[wg] failed to remove stale peer for ${device.name}: ${e}`,
            );
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
                    wgPublicKey: null,
                    wgClientIp,
                    wgPsk,
                    radiusSecret,
                    registrationToken,
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
                id: crypto.randomUUID(),
                nasDeviceId: device.id,
                script,
                hotspotPages: pages,
                hotspotInterface: input.hotspotInterface,
                hotspotNetwork: input.hotspotNetwork,
                hotspotDnsName: input.hotspotDnsName ?? null,
                brandName: input.brandName ?? null,
                wgPublicKey: null,
                wgClientIp,
                wgPsk,
                radiusSecret,
                registrationToken,
                wgKeyReportedAt: null,
                status: 'pending',
            })
            .returning();
    });

    return {
        ...row,
        script: buildBootstrapScript(device.id, row.registrationToken, apiBase),
    };
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
// version). Empty values are ignored; a colliding serial number (already
// registered on another device) is skipped without failing. The server-side
// WireGuard peer itself is applied by the caller.
export async function applyNasReport(
    scriptId: string,
    nasDeviceId: string,
    report: NasReport,
) {
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
                    ...(report.boardName && { boardName: report.boardName }),
                    ...(report.architecture && {
                        architecture: report.architecture,
                    }),
                },
            };
            if (report.model) deviceUpdate.model = report.model;
            if (report.firmwareVersion) {
                // "/system resource get version" returns e.g. "7.16.2 (stable)".
                deviceUpdate.firmwareVersion =
                    report.firmwareVersion.split(' ')[0];
            }
            if (report.serialNumber) {
                deviceUpdate.serialNumber = report.serialNumber;
            }
            try {
                await tx
                    .update(nasDevice)
                    .set(deviceUpdate)
                    .where(eq(nasDevice.id, nasDeviceId));
            } catch {
                // A serial number registered on another device must not
                // block the whole report; retry without it.
                delete deviceUpdate.serialNumber;
                await tx
                    .update(nasDevice)
                    .set(deviceUpdate)
                    .where(eq(nasDevice.id, nasDeviceId));
            }
        }
        return row;
    });
}
