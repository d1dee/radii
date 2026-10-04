import { isIP } from 'node:net';

export type NasSessionPresence = 'active' | 'absent' | 'unknown';

export interface AccountingSessionIdentity {
    username: string | null;
    acctsessionid: string;
    callingstationid: string | null;
    calledstationid: string | null;
    framedipaddress: string | null;
    acctstarttime: Date | null;
    acctsessiontime?: number | null;
    pppoe: boolean;
}

interface ActiveSession {
    username: string;
    address: string;
    mac: string;
    server: string | null;
    sessionId: string | null;
    uptimeSeconds: number;
}

export interface NasSessionSnapshot {
    observedAt: Date;
    uptimeSeconds: number;
    hotspot: ActiveSession[];
    pppoe: ActiveSession[];
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid NAS response record');
    }
    return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
    if (typeof value !== 'string' || !value) {
        throw new Error('Incomplete NAS session response');
    }
    return value;
}

function normalizeMac(value: string): string | null {
    const mac = value.replace(/[:-]/g, '').toLowerCase();
    return /^[0-9a-f]{12}$/.test(mac) ? mac : null;
}

function normalizeSessionId(value: string): string | null {
    const id = value.replace(/^0x/i, '').toLowerCase();
    return /^[0-9a-f]+$/.test(id) ? id : null;
}

export function parseRouterOsDuration(value: unknown): number {
    const text = requiredString(value);
    const clock = /^(?:(\d+)w)?(?:(\d+)d)?(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(text);
    if (clock) {
        const [, weeks, days, hours, minutes, seconds] = clock;
        if (Number(minutes) >= 60 || Number(seconds) >= 60) {
            throw new Error('Invalid NAS uptime');
        }
        const total = Number(weeks ?? 0) * 604800 + Number(days ?? 0) * 86400
            + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
        if (!Number.isFinite(total)) throw new Error('Invalid NAS uptime');
        return total;
    }
    if (!/^(?:\d+w)?(?:\d+d)?(?:\d+h)?(?:\d+m)?(?:\d+(?:\.\d+)?s)?(?:\d+ms)?$/.test(text)) {
        throw new Error('Invalid NAS uptime');
    }
    const units: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1, ms: 0.001 };
    const seconds = [...text.matchAll(/(\d+(?:\.\d+)?)(ms|w|d|h|m|s)/g)]
        .reduce((sum, match) => sum + Number(match[1]) * units[match[2]!]!, 0);
    if (!Number.isFinite(seconds)) throw new Error('Invalid NAS uptime');
    return seconds;
}

export function parseNasActiveSessions(value: unknown, pppoe: boolean): ActiveSession[] {
    if (!Array.isArray(value)) throw new Error('Invalid NAS active-session list');
    return value.map((item) => {
        const row = record(item);
        if (pppoe && row.service !== 'pppoe') throw new Error('Unexpected PPP service in NAS snapshot');
        const username = requiredString(row[pppoe ? 'name' : 'user']);
        const address = requiredString(row.address);
        const mac = normalizeMac(requiredString(row[pppoe ? 'caller-id' : 'mac-address']));
        const uptimeSeconds = parseRouterOsDuration(row.uptime);
        if (isIP(address) !== 4 || !mac) throw new Error('Invalid NAS session identity');
        const sessionId = row['session-id'] === undefined
            ? null : normalizeSessionId(requiredString(row['session-id']));
        if ((pppoe || row['session-id'] !== undefined) && !sessionId) {
            throw new Error('Invalid NAS session identifier');
        }
        return {
            username, address, mac, uptimeSeconds, sessionId,
            server: pppoe ? null : requiredString(row.server),
        };
    });
}

export function nasSessionPresence(
    session: AccountingSessionIdentity,
    snapshot: NasSessionSnapshot,
): NasSessionPresence {
    if (!session.username || !session.acctstarttime) return 'unknown';
    const sessions = session.pppoe ? snapshot.pppoe : snapshot.hotspot;
    if (session.pppoe) {
        const id = normalizeSessionId(session.acctsessionid);
        if (!id) return 'unknown';
        return sessions.some((active) => active.sessionId === id && active.username === session.username)
            ? 'active' : 'absent';
    }
    const mac = session.callingstationid && normalizeMac(session.callingstationid);
    if (!mac || !session.framedipaddress || !session.calledstationid) return 'unknown';
    const matches = sessions.filter((active) => active.username === session.username
        && active.mac === mac && active.address === session.framedipaddress
        && active.server === session.calledstationid);
    if (!matches.length) return 'absent';

    // HotSpot often exposes no accounting session ID. A matching identity with
    // uncertain start time is preserved, rather than risking a false closure.
    const toleranceMs = 120_000;
    let ambiguous = false;
    for (const active of matches) {
        if (active.sessionId) {
            const id = normalizeSessionId(session.acctsessionid);
            if (!id) return 'unknown';
            if (active.sessionId === id) return 'active';
            continue;
        }
        const startedAt = snapshot.observedAt.getTime() - active.uptimeSeconds * 1000;
        if (Math.abs(startedAt - session.acctstarttime.getTime()) <= toleranceMs) return 'active';
        // Wall-clock shifts or delayed Start packets can skew estimated start
        // times. Only a shorter uptime than previously accounted proves that
        // this is a replacement session with the same HotSpot identity.
        if (typeof session.acctsessiontime !== 'number' || !Number.isFinite(session.acctsessiontime)
            || active.uptimeSeconds + toleranceMs / 1000 >= session.acctsessiontime) {
            ambiguous = true;
        }
    }
    return ambiguous ? 'unknown' : 'absent';
}

export function isNasManagementAddress(host: string, subnet: string, serverIp: string): boolean {
    if (isIP(host) !== 4 || isIP(serverIp) !== 4 || host === serverIp) return false;
    const parts = subnet.split('/');
    if (parts.length !== 2) return false;
    const [network, prefixText] = parts;
    const prefix = Number(prefixText);
    if (!network || isIP(network) !== 4 || !prefixText || !Number.isInteger(prefix) || prefix < 1 || prefix > 30) return false;
    const numeric = (ip: string) => ip.split('.').reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    const base = (numeric(network) & mask) >>> 0;
    const broadcast = (base | ~mask) >>> 0;
    const address = numeric(host);
    return address > base && address < broadcast && ((numeric(serverIp) & mask) >>> 0) === base;
}

export async function fetchNasSessionSnapshot(
    target: { host: string; username: string; password: string },
    timeoutMs: number,
    fetcher: typeof fetch = fetch,
): Promise<NasSessionSnapshot> {
    const signal = AbortSignal.timeout(timeoutMs);
    const authorization = `Basic ${Buffer.from(`${target.username}:${target.password}`).toString('base64')}`;
    const read = async (path: string): Promise<unknown> => {
        // Bun supports proxy:false; the installed Bun types predate this flag.
        // Never send management credentials through an environment HTTP proxy.
        const init: RequestInit & { proxy: false } = {
            headers: { Authorization: authorization, Accept: 'application/json' },
            redirect: 'error', signal, proxy: false,
        };
        const response = await fetcher(`http://${target.host}/rest/${path}`, init);
        if (!response.ok) throw new Error(`NAS monitoring HTTP ${response.status}`);
        if (!response.body) throw new Error('Empty NAS monitoring response');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        let bytes = 0;
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                bytes += chunk.value.byteLength;
                if (bytes > 4 * 1024 * 1024) throw new Error('NAS monitoring response too large');
                text += decoder.decode(chunk.value, { stream: true });
            }
            text += decoder.decode();
            return JSON.parse(text);
        } finally {
            await reader.cancel();
        }
    };
    const uptime = (value: unknown) => {
        const row = Array.isArray(value) && value.length === 1 ? value[0] : value;
        return parseRouterOsDuration(record(row).uptime);
    };
    const beforeAt = Date.now();
    const before = uptime(await read('system/resource'));
    const [hotspot, pppoe] = await Promise.all([
        read('ip/hotspot/active'), read('ppp/active?service=pppoe'),
    ]);
    const after = uptime(await read('system/resource'));
    const observedAt = new Date();
    if (after < before || Math.abs((after - before) - (observedAt.getTime() - beforeAt) / 1000) > 5) {
        throw new Error('NAS restarted during session snapshot');
    }
    const snapshot = {
        observedAt, uptimeSeconds: after,
        hotspot: parseNasActiveSessions(hotspot, false),
        pppoe: parseNasActiveSessions(pppoe, true),
    };
    if ([...snapshot.hotspot, ...snapshot.pppoe].some((session) => session.uptimeSeconds > after + 5)) {
        throw new Error('NAS session uptime exceeds router uptime');
    }
    return snapshot;
}
