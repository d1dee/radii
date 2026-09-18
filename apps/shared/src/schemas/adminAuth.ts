import { z } from 'zod';

// --- Admin console auth schemas ---------------------------------------------
// Used by the admin frontend forms and (for password strength) the API-side
// sign-up guard on the dedicated admin BetterAuth instance.

export const ADMIN_PASSWORD_MIN_LENGTH = 8;

// The four character classes; a valid admin password contains at least two.
const PASSWORD_CLASSES: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /[a-z]/, label: 'lowercase letters' },
    { pattern: /[A-Z]/, label: 'uppercase letters' },
    { pattern: /[0-9]/, label: 'numbers' },
    { pattern: /[^A-Za-z0-9]/, label: 'symbols' },
];

// Returns an error message when the password is too weak, null when valid.
export function validateAdminPassword(password: string): string | null {
    if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
        return `Password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`;
    }
    const classCount = PASSWORD_CLASSES.filter((c) =>
        c.pattern.test(password),
    ).length;
    if (classCount < 2) {
        return 'Password must combine at least 2 of: lowercase letters, uppercase letters, numbers, symbols';
    }
    return null;
}

export const zAdminPassword = z
    .string()
    .min(
        ADMIN_PASSWORD_MIN_LENGTH,
        `Password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`,
    )
    .refine((v) => validateAdminPassword(v) === null, {
        message:
            'Password must combine at least 2 of: lowercase letters, uppercase letters, numbers, symbols',
    });

const zAdminEmail = z.email('Enter a valid email address');

export const adminRegisterSchema = z
    .object({
        name: z.string().trim().min(2, 'Enter your name').max(80),
        email: zAdminEmail,
        password: zAdminPassword,
        confirmPassword: z.string(),
    })
    .refine((v) => v.password === v.confirmPassword, {
        message: 'Passwords do not match',
        path: ['confirmPassword'],
    });

export const adminLoginSchema = z.object({
    email: zAdminEmail,
    password: z.string().min(1, 'Enter your password'),
});

export const adminVerifyOtpSchema = z.object({
    email: zAdminEmail,
    otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

// Email-OTP password reset: the admin requests a 6-digit code by email, then
// redeems it with a new password that satisfies the admin password policy.
export const adminResetPasswordSchema = z
    .object({
        email: zAdminEmail,
        otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
        password: zAdminPassword,
        confirmPassword: z.string(),
    })
    .refine((v) => v.password === v.confirmPassword, {
        message: 'Passwords do not match',
        path: ['confirmPassword'],
    });

export type AdminRegisterSchema = z.infer<typeof adminRegisterSchema>;
export type AdminLoginSchema = z.infer<typeof adminLoginSchema>;
export type AdminVerifyOtpSchema = z.infer<typeof adminVerifyOtpSchema>;
export type AdminResetPasswordSchema = z.infer<typeof adminResetPasswordSchema>;
