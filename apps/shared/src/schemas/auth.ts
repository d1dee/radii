import {
    isValidPhoneNumber,
    parsePhoneNumberFromString,
} from 'libphonenumber-js';
import { z } from 'zod';

// Phone numbers are captured in ITU-T E.164 canonical form (e.g.
// +254712345678). Validation uses libphonenumber-js, which checks length,
// prefix and country rules rather than a single-country regex. The value is
// normalized to E.164 on success so storage/lookups are consistent.
export const zPhoneNumber = z
    .string()
    .trim()
    .refine((v) => !!v && safeIsValidPhone(v), 'Enter a valid phone number')
    .transform((v) => parsePhoneNumberFromString(v)?.format('E.164') ?? v);

function safeIsValidPhone(value: string): boolean {
    try {
        return isValidPhoneNumber(value);
    } catch {
        return false;
    }
}

const zPin = z
    .string()
    .regex(/^\d{4}$/, 'PIN must be exactly 4 digits')
    .length(4, 'PIN must be exactly 4 digits');

export const loginSchema = z.object({
    phoneNumber: zPhoneNumber,
    pin: zPin,
});

export const signUpSchema = z
    .object({
        phoneNumber: zPhoneNumber,
        pin: zPin,
        verifyPin: zPin,
    })
    .refine((v) => v.pin === v.verifyPin, {
        message: 'PIN and verification PIN do not match',
        path: ['verifyPin'],
    });

export type LoginSchema = z.infer<typeof loginSchema>;
export type SignUpSchema = z.infer<typeof signUpSchema>;
