// Customer PIN resets use the owning admin's WhatsApp session. The module
// path remains unchanged; OTP storage and the admin support UI are unchanged.

import { apiLogger, logOtpForDebug } from '../logging';
import { sendAdminWhatsAppText } from './adminWhatsApp';
import { resolvePortalOtpOwner } from './portalOtpOwner';

const logger = apiLogger.getChild('portal-otp');

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

export async function sendPortalOtpWhatsApp(input: SmsOtpInput): Promise<void> {
    if (input.type !== 'forget-password') return;
    if (!/^[1-9]\d{7,14}@hotspot\.local$/.test(input.email)) return;
    logOtpForDebug('portal', input.type, input.otp);
    try {
        const adminId = await resolvePortalOtpOwner(input.email);
        if (!adminId) {
            logger.warn('Portal reset code delivery skipped; no unambiguous network owner');
            return;
        }
        await sendAdminWhatsAppText(adminId, phoneFromPortalEmail(input.email),
            `Your PIN reset code is ${input.otp}. It expires in 5 minutes. Do not share this code.`);
    } catch {
        // Never log upstream exceptions: they may contain the OTP, recipient,
        // credentials or provider response. Public reset requests stay generic.
        logger.warn('Portal reset code WhatsApp delivery failed');
    }
}
