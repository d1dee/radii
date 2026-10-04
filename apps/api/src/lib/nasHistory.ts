import { isIPv4 } from 'node:net';
import { sql, type SQL } from 'drizzle-orm';

// Registry descriptions are server-issued UUID bindings, not device metadata.
// Keep nasname textual: FreeRADIUS also accepts DNS names and CIDR networks.
export const nasAddressClaims = sql`
    select device.id as device_id, device.owner_id,
        host(device.ip_address) as ip, false as historical
    from nas_device device
    union
    select device.id, device.owner_id, host(setup.wg_client_ip), false
    from nas_device device
    inner join nas_setup_script setup on setup.nas_device_id = device.id
    union
    select device.id, device.owner_id, registry.nasname, true
    from nas_device device
    inner join nas registry
        on registry.description = 'radii managed (' || device.id::text || ')'
    where registry.nasname ~ '^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])([.](25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$'
`;

export function scopedNasHistoryAddress(
    address: SQL,
    adminId: string,
    nasDeviceId?: SQL,
): SQL {
    return sql`exists (
        select 1 from (${nasAddressClaims}) owned_claim
        where owned_claim.owner_id = ${adminId}
          and owned_claim.ip = host(${address})
          ${nasDeviceId ? sql`and owned_claim.device_id = ${nasDeviceId}` : sql``}
    ) and not exists (
        select 1 from (${nasAddressClaims}) other_claim
        where other_claim.ip = host(${address})
          and (other_claim.owner_id <> ${adminId}
            ${nasDeviceId ? sql`or other_claim.device_id <> ${nasDeviceId}` : sql``})
    )`;
}

export type NasAddressClaim = {
    device_id: string;
    owner_id: string;
    ip: string;
    historical: boolean;
};

export function visibleNasAddresses(
    claims: NasAddressClaim[],
    adminId: string,
    nasDeviceId?: string,
): Set<string> {
    const valid = claims.filter((claim) =>
        Boolean(claim.ip) && (!claim.historical || isIPv4(claim.ip)),
    );
    const excluded = new Set(valid.filter((claim) =>
        claim.owner_id !== adminId ||
        (nasDeviceId !== undefined && claim.device_id !== nasDeviceId),
    ).map((claim) => claim.ip));
    return new Set(valid.filter((claim) =>
        claim.owner_id === adminId &&
        (nasDeviceId === undefined || claim.device_id === nasDeviceId) &&
        !excluded.has(claim.ip),
    ).map((claim) => claim.ip));
}
