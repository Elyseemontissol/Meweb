import { redis, KEYS } from './_lib/redis.js';
import { verifyToken } from './_lib/tokens.js';
import { advanceTheme } from './_lib/themes.js';
import { postToPage } from './_lib/facebook.js';

function htmlPage(title, body, status = 200) {
  return {
    status,
    html: `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>body{font-family:-apple-system,Segoe UI,sans-serif;max-width:600px;margin:48px auto;padding:24px;color:#111;}
      .ok{color:#16a34a;} .err{color:#dc2626;} pre{background:#f3f4f6;padding:12px;border-radius:6px;overflow:auto;}</style>
      </head><body>${body}</body></html>`,
  };
}

function send(res, page) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(page.status).send(page.html);
}

export default async function handler(req, res) {
  const token = req.query?.token;
  if (!token) return send(res, htmlPage('Missing token', '<h1 class="err">Missing token</h1>', 400));

  const payload = verifyToken(token, process.env.FB_APPROVAL_SECRET);
  if (!payload || payload.action !== 'approve') {
    return send(res, htmlPage('Invalid token', '<h1 class="err">Invalid or forged token</h1>', 401));
  }

  const key = KEYS.draft(payload.draftId);
  const raw = await redis.getdel(key);
  if (!raw) {
    return send(res, htmlPage('Already used', '<h1 class="err">Draft already used or expired</h1>', 410));
  }
  const draft = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (draft.dry_run) {
    return send(res, htmlPage('Dry run',
      `<h1 class="ok">Dry run — would have posted</h1><pre>${escape(draft.caption)}</pre>`));
  }

  const message = [draft.caption, (draft.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
  try {
    const result = await postToPage({
      pageId: process.env.FB_PAGE_ID,
      accessToken: process.env.FB_PAGE_ACCESS_TOKEN,
      message,
      imageUrl: draft.image_url || null,
    });
    await advanceTheme(redis);
    await redis.lpush(KEYS.history, JSON.stringify({
      ts: new Date().toISOString(),
      theme: draft.theme,
      draft_id: payload.draftId,
      status: 'posted',
      fb_post_id: result.id || result.post_id,
      caption: draft.caption,
    }));
    await redis.ltrim(KEYS.history, 0, 49);
    return send(res, htmlPage('Posted',
      `<h1 class="ok">Posted ✓</h1><p>Facebook ID: <code>${escape(result.id || result.post_id)}</code></p>`));
  } catch (err) {
    // Restore the draft so it can be retried after the issue is fixed.
    await redis.set(key, JSON.stringify(draft), { ex: 72 * 60 * 60 });
    await redis.lpush(KEYS.history, JSON.stringify({
      ts: new Date().toISOString(),
      theme: draft.theme,
      draft_id: payload.draftId,
      status: 'error',
      error: err.message,
    }));
    await redis.ltrim(KEYS.history, 0, 49);
    return send(res, htmlPage('Post failed',
      `<h1 class="err">Facebook rejected the post</h1><pre>${escape(err.message)}</pre><p>Draft is preserved — fix the issue and click the link again.</p>`, 502));
  }
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
