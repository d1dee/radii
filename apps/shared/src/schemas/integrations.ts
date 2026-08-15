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

export const createNasDeviceSchema = z.object({
    name: z.string().min(1, 'Name is required'),
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
        .optional()
        .transform((v) => (v?.trim() ? v.trim() : undefined)),
    serialNumber: z
        .string()
        .optional()
        .transform((v) => (v?.trim() ? v.trim() : undefined)),
    firmwareVersion: z
        .string()
        .optional()
        .transform((v) => (v?.trim() ? v.trim() : undefined)),
    location: z
        .string()
        .optional()
        .transform((v) => (v?.trim() ? v.trim() : undefined)),
    status: z.enum(nasDeviceStatuses).default('active'),
});

export const nasSetupScriptStatuses = ['pending', 'applied', 'failed'] as const;
export type NasSetupScriptStatus = (typeof nasSetupScriptStatuses)[number];

// Options accepted when generating a device setup script. Everything is
// optional; the API fills in defaults from environment configuration.
export const generateSetupScriptSchema = z.object({
    hotspotInterface: z.string().trim().min(1).max(40).default('ether2'),
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
        .regex(
            z.regexes.domain,
            'Must be a valid domain name, e.g. hotspot.example.com',
        )
        .optional(),
    brandName: z.string().trim().min(2).max(60).optional(),
});

export type GenerateSetupScriptInput = z.infer<
    typeof generateSetupScriptSchema
>;
