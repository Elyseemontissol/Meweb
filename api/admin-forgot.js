import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
import crypto from 'crypto';

const redis = Redis.fromEnv();
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const token = crypto.randomBytes(32).toString('hex');

    // Token valid for 30 minutes
    await redis.set(`admin:reset:${token}`, 'valid', { ex: 1800 });

    const resetUrl = `https://montissolessentials.com/invoice.html#reset=${token}`;

    await resend.emails.send({
      from: 'Montissol Essentials <noreply@montissolessentials.com>',
      to: 'ElyseeM@MontissolEssentials.com',
      subject: 'Admin Password Reset Request',
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif; max-width:600px; margin:0 auto; padding:24px;">
          <h2 style="color:#1a1a1a; margin-bottom:16px;">Password Reset Requested</h2>
          <p style="color:#333; line-height:1.6;">A password reset was requested for the Montissol Essentials admin panel.</p>
          <p style="color:#333; line-height:1.6;">Click the button below to set a new password. This link will expire in <strong>30 minutes</strong>.</p>
          <p style="margin:28px 0;">
            <a href="${resetUrl}" style="display:inline-block; background:#E74D10; color:#fff; padding:14px 32px; border-radius:999px; text-decoration:none; font-weight:700; font-size:14px;">Reset Password</a>
          </p>
          <hr style="border:none; border-top:1px solid #eee; margin:24px 0;">
          <p style="color:#666; font-size:.85rem;">If you didn't request this reset, you can safely ignore this email. Your password will not be changed.</p>
          <p style="color:#999; font-size:.75rem; word-break:break-all;">Or copy this link into your browser:<br>${resetUrl}</p>
        </div>
      `,
    });

    return res.status(200).json({ ok: true, message: 'Reset email sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to send reset email.' });
  }
}
