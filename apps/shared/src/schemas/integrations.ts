import { z } from 'zod';

export const nasDeviceStatuses = [
    'active',
    'inactive',
    'maintenance',
    'offline',
] as const;
export type NasDeviceStatus = (typeof nasDeviceStatuses)[number];

export const nasDeviceOses = ['routeros'] as const;
export type NasDeviceOs = (typeof nasDeviceOses)[number];

export const nasConnectionTypes = ['wireguard', 'direct', 'ovpn'] as const;
export type NasConnectionType = (typeof nasConnectionTypes)[number];

// NAS device strings (name/model/serial/location) and interface names are
// interpolated into generated RouterOS setup scripts and their comment
// headers. Reject control characters (NUL, CR, LF, and other C0/C1 controls)
// that could break out of a line or string literal, and cap lengths
// conservatively. Values are still trimmed as before.
const NO_CONTROL_CHARS = /^[^\u0000-\u001F\u007F]*$/;
const CONTROL_CHARS_MESSAGE = 'Must not contain control characters';

export const createNasDeviceSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, 'Name is required')
        .max(120, 'Name must be at most 120 characters')
        .regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE),
    os: z.enum(nasDeviceOses),
    ipAddress: z.ipv4().or(z.ipv6('Must be a valid IPv4 or IPv6 address')),
    macAddress: z.mac('Must be a valid MAC address').or(
        z
            .string()
            .optional()
            .transform((v) => (v?.trim() ? v.trim() : undefined)),
    ),

    // Optional: auto-detected from the device when its setup script runs.
    model: z
        .string()
        .trim()
        .max(64, 'Model must be at most 64 characters')
        .regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE)
        .optional()
        .transform((v) => (v?.trim() ? v.trim() : undefined)),
    serialNumber: z
        .string()
        .trim()
        .max(64, 'Serial number must be at most 64 characters')
        .regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE)
        .optional()
        .transform((v) => (v?.trim() ? v.trim() : undefined)),
    firmwareVersion: z
        .string()
        .trim()
        .max(64, 'Firmware version must be at most 64 characters')
        .regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE)
        .optional()
        .transform((v) => (v?.trim() ? v.trim() : undefined)),
    location: z
        .string()
        .trim()
        .max(120, 'Location must be at most 120 characters')
        .regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE)
        .optional()
        .transform((v) => (v?.trim() ? v.trim() : undefined)),
    status: z.enum(nasDeviceStatuses).default('active'),
});

export const nasSetupScriptStatuses = ['pending', 'applied', 'failed'] as const;
export type NasSetupScriptStatus = (typeof nasSetupScriptStatuses)[number];

// Options accepted when generating a device setup script. Everything is
// optional; the API fills in defaults from environment configuration.
export const generateSetupScriptSchema = z.object({
    hotspotInterface: z
        .string()
        .trim()
        .min(1)
        .max(40)
        .regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE)
        .default('ether2'),
    hotspotNetwork: z
        .string()
        .trim()
        .regex(
            z.regexes.cidrv4,
            'Must be an IPv4 network in CIDR form, e.g. 10.5.5.0/24',
        )
        .default('10.100.0.0/16'),
    hotspotDnsName: z
        .string()
        .trim()
        .optional()
        .transform((v) => (v ? v : undefined))
        .pipe(
            z
                .string()
                .regex(
                    z.regexes.domain,
                    'Must be a valid domain name, e.g. hotspot.example.com',
                )
                .optional(),
        ),
    brandName: z
        .string()
        .trim()
        .optional()
        .transform((v) => (v ? v : undefined))
        .pipe(
            z
                .string()
                .min(2)
                .max(60)
                .regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE)
                .optional(),
        ),
    // PPPoE server options. The server authenticates dialers via RADIUS
    // (stable per-customer credentials managed by the portal payments); an
    // empty service name means the server accepts any service name.
    pppoeInterface: z
        .string()
        .trim()
        .min(1)
        .max(40)
        .regex(NO_CONTROL_CHARS, CONTROL_CHARS_MESSAGE)
        .default('ether1'),
    pppoeNetwork: z
        .string()
        .trim()
        .regex(
            z.regexes.cidrv4,
            'Must be an IPv4 network in CIDR form, e.g. 10.101.0.0/16',
        )
        .default('10.101.0.0/16'),
    // Restrict RouterOS management services (ssh/winbox/api/www) to the
    // WireGuard management subnet and disable telnet/ftp/api-ssl/www-ssl.
    ipLockdown: z.boolean().default(true),
});

export type GenerateSetupScriptInput = z.infer<
    typeof generateSetupScriptSchema
>;
