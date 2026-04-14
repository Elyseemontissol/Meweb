import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const { token, newPassword } = req.body || {};

  if (!token || !newPassword) {
    return res.status(400).json({ ok: false, error: 'Token and new password are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters.' });
  }

  try {
    const valid = await redis.get(`admin:reset:${token}`);
    if (!valid) {
      return res.status(401).json({ ok: false, error: 'This reset link has expired or is invalid.' });
    }

    await redis.set('admin:password', newPassword);
    await redis.del(`admin:reset:${token}`);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to reset password.' });
  }
}
