// Customer (portal) transactional SMS — PIN reset one-time codes.
//
// Portal users authenticate with phone+PIN and have no email channel, so the
// forget-PIN flow delivers its 6-digit code by SMS. The provider integration
// is NOT wired yet: for now the code is printed to the server console and,
// because the better-auth emailOTP plugin stores OTPs in plain text in the
// `verification` table, admins can also read the pending code from the
// customer detail endpoint (admin user drawer) for debugging.
//
// When the real SMS provider lands, implement delivery here and switch the
// emailOTP `storeOTP` option to "hashed" so plaintext codes stop persisting.

export type SmsOtpType =
    | 'email-verification'
    | 'sign-in'
    | 'forget-password'
    | 'change-email';

export interface SmsOtpInput {
    // Synthetic portal email (`<digits>@hotspot.local`); the local part is
    // the phone number digits.
    email: string;
    otp: string;
    type: SmsOtpType;
}

export function phoneFromPortalEmail(email: string): string {
    return email.split('@')[0] ?? email;
}

export async function sendPortalOtpSms(input: SmsOtpInput): Promise<void> {
    if (input.type !== 'forget-password') return;
    const phone = phoneFromPortalEmail(input.email);
    // TODO: deliver via the SMS provider once integrated.
    console.log(
        `[portal-sms] SMS provider not integrated — PIN reset code for +${phone}: ${input.otp}`,
    );
}
