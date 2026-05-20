import { redis, KEYS } from './_lib/redis.js';
import { verifyToken } from './_lib/tokens.js';
import { advanceTheme } from './_lib/themes.js';

function send(res, status, body) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(status).send(
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;max-width:600px;margin:48px auto;padding:24px;">${body}</body></html>`
  );
}

export default async function handler(req, res) {
  const token = req.query?.token;
  const payload = token && verifyToken(token, process.env.FB_APPROVAL_SECRET);
  if (!payload || payload.action !== 'reject') {
    return send(res, 401, '<h1 style="color:#dc2626;">Invalid token</h1>');
  }
  const key = KEYS.draft(payload.draftId);
  const raw = await redis.getdel(key);
  if (!raw) return send(res, 410, '<h1>Already used or expired</h1>');
  const draft = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (!draft.dry_run) await advanceTheme(redis);
  await redis.lpush(KEYS.history, JSON.stringify({
    ts: new Date().toISOString(),
    theme: draft.theme,
    draft_id: payload.draftId,
    status: 'rejected',
  }));
  await redis.ltrim(KEYS.history, 0, 49);

  return send(res, 200, '<h1>Rejected ✓</h1><p>Theme rotation advanced. Next week tries a different angle.</p>');
}
