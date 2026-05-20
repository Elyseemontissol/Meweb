import { redis, KEYS } from './_lib/redis.js';
import { verifyToken } from './_lib/tokens.js';
import { advanceTheme } from './_lib/themes.js';
import { postToPage } from './_lib/facebook.js';

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function htmlShell(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Edit FB draft</title>
    <style>body{font-family:-apple-system,Segoe UI,sans-serif;max-width:680px;margin:32px auto;padding:24px;}
    textarea{width:100%;height:260px;font:14px ui-monospace,monospace;padding:12px;border:1px solid #ccc;border-radius:6px;}
    button{padding:12px 24px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:16px;cursor:pointer;}
    img{max-width:100%;border-radius:8px;margin:12px 0;}</style>
    </head><body>${body}</body></html>`;
}

async function readBody(req) {
  if (req.body) return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  const params = new URLSearchParams(raw);
  const obj = {};
  for (const [k, v] of params) obj[k] = v;
  return obj;
}

export default async function handler(req, res) {
  const token = req.query?.token;
  const payload = token && verifyToken(token, process.env.FB_APPROVAL_SECRET);
  if (!payload || payload.action !== 'edit') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(401).send(htmlShell('<h1 style="color:#dc2626;">Invalid token</h1>'));
  }
  const key = KEYS.draft(payload.draftId);

  if (req.method === 'POST') {
    const body = await readBody(req);
    const newCaption = (body.caption || '').toString();
    const raw = await redis.getdel(key);
    if (!raw) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(410).send(htmlShell('<h1>Draft expired</h1>'));
    }
    const draft = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (draft.dry_run) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(htmlShell(`<h1>Dry run — would post:</h1><pre>${escape(newCaption)}</pre>`));
    }
    const message = [newCaption, (draft.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
    try {
      const result = await postToPage({
        pageId: process.env.FB_PAGE_ID,
        accessToken: process.env.FB_PAGE_ACCESS_TOKEN,
        message,
        imageUrl: draft.image_url || null,
      });
      await advanceTheme(redis);
      await redis.lpush(KEYS.history, JSON.stringify({
        ts: new Date().toISOString(), theme: draft.theme, draft_id: payload.draftId,
        status: 'posted_edited', fb_post_id: result.id || result.post_id, caption: newCaption,
      }));
      await redis.ltrim(KEYS.history, 0, 49);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(htmlShell(`<h1 style="color:#16a34a;">Posted ✓</h1>`));
    } catch (err) {
      await redis.set(key, JSON.stringify({ ...draft, caption: newCaption }), { ex: 72 * 60 * 60 });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(502).send(htmlShell(`<h1 style="color:#dc2626;">Post failed</h1><pre>${escape(err.message)}</pre>`));
    }
  }

  // GET: render the form
  const raw = await redis.get(key);
  if (!raw) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(410).send(htmlShell('<h1>Draft expired or already used</h1>'));
  }
  const draft = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const img = draft.image_url ? `<img src="${draft.image_url}" alt="">` : '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(htmlShell(`
    <h1>Edit draft</h1>
    <p>Theme: ${escape(draft.theme)}</p>
    ${img}
    <form method="POST" action="?token=${escape(token)}">
      <textarea name="caption">${escape(draft.caption)}</textarea>
      <p>Hashtags (kept): ${escape((draft.hashtags || []).join(' '))}</p>
      <button type="submit">Post to Facebook</button>
    </form>
  `));
}
