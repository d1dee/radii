// Per-admin M-Pesa providers. Admins may store their own M-Pesa credentials
// in their settings (admin_setting table); payments attributed to an admin
// (payment -> NAS device -> owner) then use a dedicated provider instance
// named "mpesa-<adminId>" so transaction rows and callback URLs stay tied to
// the right credentials. When an admin has not configured their own
// credentials the caller falls back to the server-wide provider registered
// from env (see ./index.ts).

import { apiLogger } from '../../logging';
import { getAdminSettings } from '../adminSettings';
import { MPESA_PROVIDER_NAME, MpesaPaymentProvider } from './mpesa/provider';
import { PaymentProviderError, type PaymentProvider } from './types';

const logger = apiLogger.getChild('payments');

// Provider-name prefix encoding the owning admin: "mpesa-<adminId>".
const MPESA_ADMIN_PREFIX = `${MPESA_PROVIDER_NAME}-`;

export function adminMpesaProviderName(adminId: string): string {
    return `${MPESA_ADMIN_PREFIX}${adminId}`;
}

// Extracts the admin id from a per-admin provider name, or null when the
// name is not a per-admin M-Pesa provider.
export function parseAdminIdFromProviderName(
    providerName: string,
): string | null {
    if (!providerName.startsWith(MPESA_ADMIN_PREFIX)) return null;
    return providerName.slice(MPESA_ADMIN_PREFIX.length) || null;
}

interface CachedProvider {
    // Fingerprint of the M-Pesa section the instance was built from; a
    // mismatch means the admin saved new credentials and the instance is
    // rebuilt.
    configKey: string;
    provider: MpesaPaymentProvider;
}

const cache = new Map<string, CachedProvider>();

// Called by saveAdminSettings so the next payment picks up new credentials.
export function invalidateAdminMpesaProvider(adminId: string): void {
    cache.delete(adminId);
}

// Resolves the M-Pesa provider for an admin, or null when the admin has not
// configured their own credentials (caller falls back to the global
// provider). Throws PaymentProviderError when useOwnCredentials is on but
// the stored configuration is unusable — falling back to the global
// shortcode in that case would silently charge the wrong till.
export async function getAdminMpesaProvider(
    adminId: string | null,
): Promise<MpesaPaymentProvider | null> {
    if (!adminId) return null;

    const settings = await getAdminSettings(adminId);
    const { mpesa } = settings;
    if (!mpesa.useOwnCredentials) {
        cache.delete(adminId);
        return null;
    }

    const configKey = JSON.stringify([
        mpesa.consumerKey,
        mpesa.consumerSecret,
        mpesa.shortcode,
        mpesa.tillNumber,
        mpesa.passkey,
        mpesa.environment,
        mpesa.initiatorName,
        mpesa.initiatorPassword,
        mpesa.certificatePath,
        mpesa.transactionType,
    ]);
    const cached = cache.get(adminId);
    if (cached && cached.configKey === configKey) return cached.provider;

    const provider = new MpesaPaymentProvider(
        {
            consumerKey: mpesa.consumerKey,
            consumerSecret: mpesa.consumerSecret,
            shortcode: mpesa.shortcode,
            tillNumber: mpesa.tillNumber || undefined,
            passkey: mpesa.passkey,
            environment: mpesa.environment,
            initiatorName: mpesa.initiatorName || undefined,
            initiatorPassword: mpesa.initiatorPassword || undefined,
            certificatePath: mpesa.certificatePath || undefined,
            transactionType: mpesa.transactionType,
        },
        adminMpesaProviderName(adminId),
    );
    cache.set(adminId, { configKey, provider });
    return provider;
}

// Resolves any provider by its stored name: server-registered providers via
// the supplied lookup, per-admin M-Pesa names by rebuilding from the admin's
// settings. Returns null when the name cannot be resolved (e.g. the admin
// later disabled their own credentials).
export async function resolveProviderByName(
    name: string,
    registered: (name: string) => PaymentProvider | undefined,
): Promise<PaymentProvider | null> {
    const known = registered(name);
    if (known) return known;
    const adminId = parseAdminIdFromProviderName(name);
    if (!adminId) return null;
    try {
        return await getAdminMpesaProvider(adminId);
    } catch (err) {
        if (err instanceof PaymentProviderError) {
            logger.error('Could not rebuild payment provider', {
                provider: name,
                error: err,
            });
            return null;
        }
        throw err;
    }
}
