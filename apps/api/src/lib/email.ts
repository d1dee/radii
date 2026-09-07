// Admin-console transactional email, delivered through the Resend HTTP API.
//
// This is the ONLY email pipeline in the product: customer (portal) users
// authenticate with phone+PIN and never receive email. Admin verification
// uses 2FA-style one-time codes rendered by a dedicated admin template, so
// admin and customer email concerns cannot collide.
//
// When RESEND_API_KEY is not set (local development), the code is printed to
// the server console instead of being sent.

import { env } from '../env';

export interface AdminOtpEmailInput {
    email: string;
    otp: string;
    type:
        | 'email-verification'
        | 'sign-in'
        | 'forget-password'
        | 'change-email';
}

function subjectFor(type: AdminOtpEmailInput['type']): string {
    switch (type) {
        case 'forget-password':
            return 'Your Radii admin password reset code';
        case 'sign-in':
            return 'Your Radii admin sign-in code';
        default:
            return 'Verify your Radii admin email';
    }
}

// Minimal standalone 2FA-style template: one large code, expiry, and a
// security notice. No shared branding/components with customer-facing mail.
function htmlFor({ email, otp, type }: AdminOtpEmailInput): string {
    const heading =
        type === 'forget-password'
            ? 'Password reset code'
            : type === 'sign-in'
              ? 'Sign-in code'
              : 'Email verification code';
    return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#0f172a;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;padding:32px;max-width:480px;">
            <tr><td>
              <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">Radii Admin Console</p>
              <h1 style="margin:0 0 16px;font-size:20px;">${heading}</h1>
              <p style="margin:0 0 20px;font-size:14px;color:#cbd5e1;">
                Enter this one-time code to continue as <strong>${email}</strong>.
                It expires in 5 minutes.
              </p>
              <p style="margin:0 0 20px;font-size:34px;font-weight:700;letter-spacing:.35em;font-family:ui-monospace,monospace;">${otp}</p>
              <p style="margin:0;font-size:12px;color:#64748b;">
                If you did not request this, you can safely ignore this email —
                but consider changing your admin password if this happens repeatedly.
              </p>
            </td></tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;color:#64748b;">
            This is a security code for administrators only. Customer portal
            accounts never receive these emails.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendAdminOtpEmail(
    input: AdminOtpEmailInput,
): Promise<void> {
    if (!env.resend.apiKey) {
        // Dev fallback: surface the code on the server console so the flow
        // remains fully testable without a Resend account.
        console.log(
            `[admin-email] RESEND_API_KEY not set — ${input.type} code for ${input.email}: ${input.otp}`,
        );
        return;
    }

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.resend.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: env.resend.from,
                to: input.email,
                subject: subjectFor(input.type),
                html: htmlFor(input),
            }),
        });
        if (!res.ok) {
            console.error(
                `[admin-email] Resend request failed (${res.status}):`,
                await res.text(),
            );
        }
    } catch (err) {
        console.error('[admin-email] could not reach Resend:', err);
    }
}
