// Server-side WireGuard peer management via the `wg` CLI.
//
// All mutations go through incremental `wg set <iface> peer ...` calls, which
// upsert a single peer via netlink without touching any other peer, so
// existing tunnels are never disturbed or re-keyed. The preshared key is
// passed through a mode-0600 temp file (the CLI's preshared-key argument is a
// path) so it never appears on a process command line.

import { chmod, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../env';
import { apiLogger } from '../logging';

const logger = apiLogger.getChild('wireguard');

export class WgError extends Error {}

export interface WgPeerConfig {
    publicKey: string;
    presharedKey?: string;
    allowedIps: string[];
}

export function wgManagementEnabled(): boolean {
    return env.wgManagePeers;
}

const PRIVILEGED_SUBCOMMANDS = new Set(['set', 'syncconf', 'show']);

async function runWg(args: string[]): Promise<string> {
    const needsSudo = env.wgUseSudo && PRIVILEGED_SUBCOMMANDS.has(args[0]);
    const cmd = needsSudo
        ? ['sudo', '-n', env.wgBin, ...args]
        : [env.wgBin, ...args];

    let proc;
    try {
        proc = Bun.spawn(cmd, {
            stdout: 'pipe',
            stderr: 'pipe',
        });
    } catch (e) {
        throw new WgError(
            `Failed to execute '${cmd[0]}' (is it installed? for sudo mode, ` +
                `does the API user have a NOPASSWD sudoers entry?): ${String(e)}`,
        );
    }
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    if (code !== 0) {
        throw new WgError(
            `wg ${args[0]} failed (exit ${code}): ${stderr.trim() || 'unknown error'}`,
        );
    }
    return new Response(proc.stdout).text();
}

// Writes secrets to a root-only temp file for the CLI and deletes it after
// use. Caller must remove the returned path.
async function writeSecretFile(content: string): Promise<string> {
    const file = path.join(os.tmpdir(), `radii-wg-${crypto.randomUUID()}.key`);
    await writeFile(file, `${content}\n`, { mode: 0o600 });
    await chmod(file, 0o600);
    return file;
}

export async function interfaceReady(): Promise<boolean> {
    try {
        await runWg(['show', env.wgIface, 'public-key']);
        return true;
    } catch (err) {
        logger.error('WireGuard interface readiness check failed', {
            error: err,
        });
        return false;
    }
}

// Adds or updates a single peer without affecting any other peer. Idempotent.
export async function upsertPeer(peer: WgPeerConfig): Promise<void> {
    const args = [
        'set',
        env.wgIface,
        'peer',
        peer.publicKey,
        'persistent-keepalive',
        '20',
    ];
    let pskFile: string | undefined;
    try {
        if (peer.presharedKey) {
            pskFile = await writeSecretFile(peer.presharedKey);
            args.push('preshared-key', pskFile);
        }
        if (peer.allowedIps.length > 0) {
            args.push('allowed-ips', peer.allowedIps.join(','));
        }
        await runWg(args);
    } finally {
        // The temp file holds a preshared key: never log its contents, but a
        // failed delete leaves secret material on disk and must be visible.
        if (pskFile)
            await unlink(pskFile).catch((err) => {
                logger.error('Failed to delete temporary preshared-key file', {
                    fileRemoved: false,
                    error: err,
                });
            });
    }
}

// Removes a single peer without affecting any other peer. Removing an
// unknown public key is a no-op.
export async function removePeer(publicKey: string): Promise<void> {
    await runWg(['set', env.wgIface, 'peer', publicKey, 'remove']);
}

// Public keys currently present on the server interface, from `wg show dump`.
export async function listPeerPublicKeys(): Promise<Set<string>> {
    const out = await runWg(['show', env.wgIface, 'dump']);
    const keys = new Set<string>();
    for (const line of out.split('\n')) {
        // dump lines are tab-separated with the peer public key first
        // (Curve25519 base64 is always 44 characters).
        const tab = line.indexOf('\t');
        if (tab !== 44) continue;
        const key = line.slice(0, tab);
        if (/^[A-Za-z0-9+/]{43}=$/.test(key)) keys.add(key);
    }
    return keys;
}
