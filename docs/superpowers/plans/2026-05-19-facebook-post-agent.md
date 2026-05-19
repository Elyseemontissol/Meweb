# Facebook Post Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a weekly Vercel-cron-driven agent that generates Facebook post drafts (caption + AI image), emails them for one-click approval, and publishes approved drafts to the Montissol Essentials Facebook Page via the Meta Graph API.

**Architecture:** Vercel serverless functions in `api/`. Weekly cron hits `/api/fb-draft`, which calls Anthropic (caption) and OpenAI (image), uploads the image to Vercel Blob, saves the draft in Upstash Redis under a UUID, and emails three signed magic-link URLs via Resend. Clicking "Approve" hits `/api/fb-approve`, which verifies the HMAC token, atomically claims the draft, and posts to the Graph API. Themes rotate `contracts → recruiting → community` on a Redis counter.

**Tech Stack:** Node.js 20 (ES modules) · Vercel serverless · Upstash Redis (`@upstash/redis`) · Vercel Blob (`@vercel/blob`) · Resend (`resend`) · Anthropic SDK (`@anthropic-ai/sdk`) · OpenAI SDK (`openai`) · Meta Graph API v21.0 (raw `fetch`) · Node built-in `node:test` runner.

**Spec:** `docs/superpowers/specs/2026-05-19-facebook-post-agent-design.md`

**Working directory for all paths in this plan:** `MontissolEssentials/` (the project root containing `package.json` and `vercel.json`). Run all commands from that directory.

---

## File Structure

**New files:**

| File | Responsibility |
|------|----------------|
| `api/_lib/tokens.js` | HMAC sign/verify for approval URLs (Vercel ignores `_`-prefixed paths for routing) |
| `api/_lib/themes.js` | Theme rotation: read/advance `fb:next_theme` in Redis |
| `api/_lib/caption.js` | Call Anthropic, parse JSON response (caption, image_prompt, hashtags) |
| `api/_lib/image.js` | Call OpenAI gpt-image-1, upload PNG bytes to Vercel Blob, return public URL |
| `api/_lib/facebook.js` | POST to Meta Graph API (`/photos` or `/feed`), Page token health check |
| `api/_lib/email.js` | Render approval-email HTML, send via Resend |
| `api/_lib/redis.js` | Single `Redis.fromEnv()` instance + key helpers |
| `api/fb-draft.js` | Weekly cron entrypoint — orchestrates draft creation |
| `api/fb-approve.js` | Magic-link endpoint — verify token, post to FB, advance theme |
| `api/fb-edit.js` | GET renders edit form; POST applies edit and posts to FB |
| `api/fb-reject.js` | Magic-link endpoint — delete draft, advance theme |
| `tests/tokens.test.js` | Unit tests for HMAC helper |
| `tests/themes.test.js` | Unit tests for theme rotation |
| `tests/caption.test.js` | Unit tests for caption JSON parsing |
| `tests/fb-draft.test.js` | Integration test for draft endpoint with mocked externals |
| `tests/fb-approve.test.js` | Integration test for approve endpoint with mocked externals |
| `prompts/system-prompt.md` | Brand-voice rules + company profile, loaded into Anthropic call |

**Modified files:**

| File | Change |
|------|--------|
| `package.json` | Add `@anthropic-ai/sdk`, `openai`, `@vercel/blob` deps; add `test` script |
| `vercel.json` | Add second cron entry for `/api/fb-draft` |

---

## Task 1: Add dependencies and test script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current package.json**

Run: `cat package.json`
Expected: shows `@upstash/redis` and `resend` only.

- [ ] **Step 2: Add new deps, test script, and ESM type**

Replace `package.json` contents with:

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.40.0",
    "@upstash/redis": "^1.37.0",
    "@vercel/blob": "^0.27.0",
    "openai": "^4.80.0",
    "resend": "^4.0.0"
  }
}
```

`"type": "module"` makes `.js` files ESM by default, which the existing api/*.js files already assume (they use `import`). Local `node --test` requires this; Vercel's runtime is lenient about it but consistency is better.

- [ ] **Step 3: Install**

Run: `npm install`
Expected: lockfile updated, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add anthropic, openai, vercel-blob deps for FB agent"
```

---

## Task 2: Shared Redis client

**Files:**
- Create: `api/_lib/redis.js`

- [ ] **Step 1: Write the module**

Create `api/_lib/redis.js`:

```js
import { Redis } from '@upstash/redis';

export const redis = Redis.fromEnv();

export const KEYS = {
  draft: (id) => `fb:draft:${id}`,
  nextTheme: 'fb:next_theme',
  history: 'fb:history',
  recruitingNextRole: 'fb:recruiting_next_role',
};

export const THEMES = ['contracts', 'recruiting', 'community'];
export const JOB_ROLES = [
  'janitorial-tech',
  'industrial-cleaning',
  'maintenance-tech',
  'qc-compliance',
  'qc-inspector',
  'site-supervisor',
];
```

- [ ] **Step 2: Commit**

```bash
git add api/_lib/redis.js
git commit -m "feat(fb-agent): shared redis client and key helpers"
```

---

## Task 3: HMAC token helper — failing test first

**Files:**
- Create: `tests/tokens.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/tokens.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../api/_lib/tokens.js';

const SECRET = 'test-secret-32-bytes-long-aaaaaa';

test('signToken + verifyToken round-trip', () => {
  const token = signToken('draft-123', 'approve', SECRET);
  const payload = verifyToken(token, SECRET);
  assert.deepEqual(payload, { draftId: 'draft-123', action: 'approve' });
});

test('verifyToken rejects forged signature', () => {
  const token = signToken('draft-123', 'approve', SECRET);
  const tampered = token.slice(0, -4) + 'AAAA';
  assert.equal(verifyToken(tampered, SECRET), null);
});

test('verifyToken rejects wrong secret', () => {
  const token = signToken('draft-123', 'approve', SECRET);
  assert.equal(verifyToken(token, 'different-secret-also-32-bytes-l'), null);
});

test('verifyToken rejects malformed token', () => {
  assert.equal(verifyToken('not-a-token', SECRET), null);
  assert.equal(verifyToken('', SECRET), null);
  assert.equal(verifyToken('a.b', SECRET), null);
});

test('signToken produces different tokens for different actions', () => {
  const a = signToken('draft-123', 'approve', SECRET);
  const r = signToken('draft-123', 'reject', SECRET);
  assert.notEqual(a, r);
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test`
Expected: FAIL — module `../api/_lib/tokens.js` not found.

- [ ] **Step 3: Implement the helper**

Create `api/_lib/tokens.js`:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function fromB64url(s) {
  return Buffer.from(s, 'base64url');
}

export function signToken(draftId, action, secret) {
  const payload = b64url(JSON.stringify({ draftId, action }));
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = b64url(createHmac('sha256', secret).update(payload).digest());
  const a = fromB64url(sig);
  const b = fromB64url(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(fromB64url(payload).toString('utf8'));
    if (typeof obj.draftId !== 'string' || typeof obj.action !== 'string') return null;
    return obj;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/tokens.js tests/tokens.test.js
git commit -m "feat(fb-agent): HMAC token signing for approval URLs"
```

---

## Task 4: Theme rotation helper — failing test first

**Files:**
- Create: `tests/themes.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/themes.test.js`:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Lightweight in-memory Redis mock matching the @upstash/redis interface we use.
function makeRedisMock() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v) { store.set(k, v); return 'OK'; },
  };
}

let mock;
beforeEach(() => { mock = makeRedisMock(); });

test('getNextTheme returns "contracts" on first call (empty redis)', async () => {
  const { getNextTheme } = await import('../api/_lib/themes.js');
  const t = await getNextTheme(mock);
  assert.equal(t, 'contracts');
});

test('advanceTheme cycles contracts -> recruiting -> community -> contracts', async () => {
  const { getNextTheme, advanceTheme } = await import('../api/_lib/themes.js');
  assert.equal(await getNextTheme(mock), 'contracts');
  await advanceTheme(mock);
  assert.equal(await getNextTheme(mock), 'recruiting');
  await advanceTheme(mock);
  assert.equal(await getNextTheme(mock), 'community');
  await advanceTheme(mock);
  assert.equal(await getNextTheme(mock), 'contracts');
});

test('getNextTheme is idempotent (does not advance)', async () => {
  const { getNextTheme } = await import('../api/_lib/themes.js');
  assert.equal(await getNextTheme(mock), 'contracts');
  assert.equal(await getNextTheme(mock), 'contracts');
  assert.equal(await getNextTheme(mock), 'contracts');
});

test('getNextTheme returns "contracts" if redis value is unknown', async () => {
  const { getNextTheme } = await import('../api/_lib/themes.js');
  await mock.set('fb:next_theme', 'garbage');
  assert.equal(await getNextTheme(mock), 'contracts');
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test`
Expected: tests in `themes.test.js` fail — module not found.

- [ ] **Step 3: Implement the helper**

Create `api/_lib/themes.js`:

```js
import { KEYS, THEMES } from './redis.js';

export async function getNextTheme(redis) {
  const stored = await redis.get(KEYS.nextTheme);
  if (THEMES.includes(stored)) return stored;
  return THEMES[0];
}

export async function advanceTheme(redis) {
  const current = await getNextTheme(redis);
  const idx = THEMES.indexOf(current);
  const next = THEMES[(idx + 1) % THEMES.length];
  await redis.set(KEYS.nextTheme, next);
  return next;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: themes tests passing (plus tokens still passing).

- [ ] **Step 5: Commit**

```bash
git add api/_lib/themes.js tests/themes.test.js
git commit -m "feat(fb-agent): theme rotation helper"
```

---

## Task 5: Caption JSON parser — failing test first

**Files:**
- Create: `tests/caption.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/caption.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptionResponse } from '../api/_lib/caption.js';

test('parses clean JSON', () => {
  const raw = '{"caption":"Hello","image_prompt":"A truck","hashtags":["#a","#b"]}';
  const out = parseCaptionResponse(raw);
  assert.deepEqual(out, { caption: 'Hello', image_prompt: 'A truck', hashtags: ['#a', '#b'] });
});

test('strips ```json fences', () => {
  const raw = '```json\n{"caption":"Hi","image_prompt":"x","hashtags":[]}\n```';
  const out = parseCaptionResponse(raw);
  assert.equal(out.caption, 'Hi');
});

test('strips plain ``` fences', () => {
  const raw = '```\n{"caption":"Hi","image_prompt":"x","hashtags":[]}\n```';
  assert.equal(parseCaptionResponse(raw).caption, 'Hi');
});

test('throws on missing required fields', () => {
  assert.throws(() => parseCaptionResponse('{"caption":"only"}'));
  assert.throws(() => parseCaptionResponse('{"image_prompt":"only"}'));
});

test('throws on invalid JSON', () => {
  assert.throws(() => parseCaptionResponse('not json at all'));
});

test('coerces missing hashtags to empty array', () => {
  const raw = '{"caption":"Hi","image_prompt":"x"}';
  assert.deepEqual(parseCaptionResponse(raw).hashtags, []);
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test`
Expected: caption tests fail — `parseCaptionResponse` not exported.

- [ ] **Step 3: Implement the parser (full caption module stub)**

Create `api/_lib/caption.js`:

```js
import Anthropic from '@anthropic-ai/sdk';

export function parseCaptionResponse(raw) {
  let text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1].trim();
  const obj = JSON.parse(text);
  if (typeof obj.caption !== 'string' || obj.caption.length === 0) {
    throw new Error('caption missing or empty');
  }
  if (typeof obj.image_prompt !== 'string' || obj.image_prompt.length === 0) {
    throw new Error('image_prompt missing or empty');
  }
  return {
    caption: obj.caption,
    image_prompt: obj.image_prompt,
    hashtags: Array.isArray(obj.hashtags) ? obj.hashtags : [],
  };
}

export async function generateCaption({ theme, weekDate, recentCaptions, systemPrompt, apiKey }) {
  const client = new Anthropic({ apiKey });
  const userPrompt = [
    `Generate a Facebook post for the Montissol Essentials Page.`,
    `Theme: ${theme}`,
    `Week of: ${weekDate}`,
    ``,
    `Recent posts (do not repeat hooks, phrases, or angles from these):`,
    ...recentCaptions.map((c, i) => `${i + 1}. ${c}`),
    ``,
    `Respond with ONLY a JSON object of the form:`,
    `{"caption": "<80-250 words>", "image_prompt": "<short description for an image generator>", "hashtags": ["#Tag1", "#Tag2", "#Tag3"]}`,
    `No prose, no markdown, no commentary.`,
  ].join('\n');
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return parseCaptionResponse(text);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: all caption tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/caption.js tests/caption.test.js
git commit -m "feat(fb-agent): caption generation and JSON parsing"
```

---

## Task 6: System prompt file

**Files:**
- Create: `prompts/system-prompt.md`

- [ ] **Step 1: Write the system prompt**

Create `prompts/system-prompt.md`:

```markdown
You write Facebook posts for Montissol Essentials LLC. Stay strictly within the facts below; never invent contracts, certifications, or capabilities.

# Company facts

- Small Business, SDVOSB set-aside capable, based in Port St. Lucie, FL.
- Federal cleaning and facility services: janitorial, industrial cleaning, HEPA vacuuming, dust-collector system cleaning, hazardous-waste support, grounds maintenance, temporary staffing.
- NAICS: 561720 (Janitorial), 541310 (Architectural), 562112 (Hazardous Waste), 334510 (Electromedical Mfg), 812332 (Industrial Launderers), 561320 (Temporary Help).
- Past performance: U.S. Air Force — Tinker AFB (plasma spray booth and dust collector cleaning); U.S. Customs and Border Protection (facility services for Border Patrol).
- Differentiators: federal aviation maintenance facility experience, HEPA filtration cleaning systems, SDVOSB-capable.
- Website: www.MontissolEssentials.com. Phone: 754-802-5327.

# Voice rules

- Professional, confident, federal-facing. Never boastful or hype-driven.
- No emojis on `contracts` or `recruiting` themes. At most 1 emoji on `community` posts.
- Maximum 3 relevant hashtags.
- Caption length: 80–250 words. The first 80 words must carry the message (Facebook truncates around 477 chars on mobile feed).
- Always include a clear, theme-appropriate CTA:
  - `contracts` → "Reach out via MontissolEssentials.com" or a phone CTA.
  - `recruiting` → link to the job page on MontissolEssentials.com.
  - `community` → soft CTA or none.
- Never invent client names, contract numbers, dollar amounts, or certifications. Use only what's listed above.
- Never use the words "synergy", "leverage", "best-in-class", or other corporate filler.

# Output format

Always respond with a single JSON object: `{"caption": "...", "image_prompt": "...", "hashtags": ["#A", "#B"]}`. No surrounding prose. No markdown fences.

The `image_prompt` should describe a realistic, brand-safe photo — federal/industrial facility settings, cleaning crews in uniform, equipment, exteriors, etc. No people whose faces would identify individuals. No text, no logos, no AI artifacts.
```

- [ ] **Step 2: Commit**

```bash
git add prompts/system-prompt.md
git commit -m "feat(fb-agent): brand-voice system prompt"
```

---

## Task 7: Image generation + Vercel Blob upload

**Files:**
- Create: `api/_lib/image.js`

No unit tests for this module — it's a thin wrapper around two external APIs. Covered by the integration test in Task 11.

- [ ] **Step 1: Write the module**

Create `api/_lib/image.js`:

```js
import OpenAI from 'openai';
import { put } from '@vercel/blob';

export async function generateImage({ prompt, draftId, openaiKey, blobToken }) {
  const client = new OpenAI({ apiKey: openaiKey });
  const resp = await client.images.generate({
    model: 'gpt-image-1',
    prompt,
    size: '1024x1024',
    n: 1,
  });
  const b64 = resp.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image data');
  const bytes = Buffer.from(b64, 'base64');
  const blob = await put(`fb-drafts/${draftId}.png`, bytes, {
    access: 'public',
    contentType: 'image/png',
    token: blobToken,
  });
  return blob.url;
}
```

- [ ] **Step 2: Commit**

```bash
git add api/_lib/image.js
git commit -m "feat(fb-agent): image generation and blob upload"
```

---

## Task 8: Facebook Graph API helper

**Files:**
- Create: `api/_lib/facebook.js`

- [ ] **Step 1: Write the module**

Create `api/_lib/facebook.js`:

```js
const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

export async function checkPageToken({ pageId, accessToken }) {
  const url = `${GRAPH_BASE}/${pageId}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Page token health check failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function postToPage({ pageId, accessToken, message, imageUrl }) {
  const endpoint = imageUrl
    ? `${GRAPH_BASE}/${pageId}/photos`
    : `${GRAPH_BASE}/${pageId}/feed`;
  const params = new URLSearchParams();
  params.set('access_token', accessToken);
  params.set('message', message);
  if (imageUrl) params.set('url', imageUrl);
  const res = await fetch(endpoint, { method: 'POST', body: params });
  const json = await res.json();
  if (!res.ok || json.error) {
    const msg = json.error?.message || JSON.stringify(json);
    throw new Error(`Graph API error (${res.status}): ${msg}`);
  }
  return json;
}

export function buildFbPostUrl(pageId, postOrPhotoId) {
  return `https://www.facebook.com/${pageId}/posts/${postOrPhotoId}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add api/_lib/facebook.js
git commit -m "feat(fb-agent): meta graph api wrapper"
```

---

## Task 9: Email template + Resend wrapper

**Files:**
- Create: `api/_lib/email.js`

- [ ] **Step 1: Write the module**

Create `api/_lib/email.js`:

```js
import { Resend } from 'resend';

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function renderApprovalEmail({ theme, weekDate, caption, hashtags, imageUrl, approveUrl, editUrl, rejectUrl, draftId, dryRun }) {
  const banner = dryRun
    ? `<div style="background:#fef3c7;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-weight:600;">TEST — would post to Facebook. No real publish.</div>`
    : '';
  const imageBlock = imageUrl
    ? `<img src="${imageUrl}" alt="" style="max-width:100%;border-radius:8px;margin:12px 0;"/>`
    : `<div style="padding:12px;border:1px dashed #ccc;border-radius:8px;color:#666;margin:12px 0;">No image (generation failed) — post will be text-only.</div>`;
  const tags = hashtags.length
    ? `<p style="color:#1d4ed8;">${escapeHtml(hashtags.join(' '))}</p>`
    : '';
  const btn = (href, label, bg) =>
    `<a href="${href}" style="display:inline-block;padding:10px 18px;background:${bg};color:#fff;border-radius:6px;text-decoration:none;margin-right:8px;">${label}</a>`;
  return `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:620px;margin:auto;padding:24px;">
      ${banner}
      <h2 style="margin:0 0 8px 0;">FB draft — theme: ${escapeHtml(theme)}</h2>
      <p style="color:#666;margin:0 0 8px 0;">Week of ${escapeHtml(weekDate)} · Draft ID ${escapeHtml(draftId)}</p>
      ${imageBlock}
      <div style="white-space:pre-wrap;line-height:1.5;">${escapeHtml(caption)}</div>
      ${tags}
      <div style="margin-top:24px;">
        ${btn(approveUrl, '✅ Approve & post', '#16a34a')}
        ${btn(editUrl, '✏️ Edit', '#2563eb')}
        ${btn(rejectUrl, '❌ Reject', '#dc2626')}
      </div>
      <p style="color:#999;font-size:12px;margin-top:24px;">Expires in 72 hours. One-time-use links.</p>
    </div>
  `;
}

export async function sendApprovalEmail({ apiKey, to, subject, html }) {
  const resend = new Resend(apiKey);
  return resend.emails.send({
    from: 'Montissol FB Agent <noreply@montissolessentials.com>',
    to,
    subject,
    html,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/_lib/email.js
git commit -m "feat(fb-agent): approval email template"
```

---

## Task 10: `/api/fb-draft` endpoint

**Files:**
- Create: `api/fb-draft.js`

- [ ] **Step 1: Write the endpoint**

Create `api/fb-draft.js`:

```js
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redis, KEYS } from './_lib/redis.js';
import { getNextTheme } from './_lib/themes.js';
import { generateCaption } from './_lib/caption.js';
import { generateImage } from './_lib/image.js';
import { signToken } from './_lib/tokens.js';
import { renderApprovalEmail, sendApprovalEmail } from './_lib/email.js';

const DRAFT_TTL_SECONDS = 72 * 60 * 60;

function appBaseUrl() {
  return process.env.PUBLIC_BASE_URL || 'https://www.montissolessentials.com';
}

async function loadSystemPrompt() {
  const path = join(process.cwd(), 'prompts', 'system-prompt.md');
  return readFile(path, 'utf8');
}

async function recentCaptions(limit = 4) {
  const entries = await redis.lrange(KEYS.history, 0, limit - 1);
  const out = [];
  for (const e of entries) {
    try {
      const obj = typeof e === 'string' ? JSON.parse(e) : e;
      if (obj.caption) out.push(obj.caption);
    } catch { /* skip */ }
  }
  return out;
}

async function appendHistory(entry) {
  await redis.lpush(KEYS.history, JSON.stringify(entry));
  await redis.ltrim(KEYS.history, 0, 49);
}

function actionUrls(draftId, secret) {
  const base = appBaseUrl();
  return {
    approveUrl: `${base}/api/fb-approve?token=${signToken(draftId, 'approve', secret)}`,
    editUrl:    `${base}/api/fb-edit?token=${signToken(draftId, 'edit', secret)}`,
    rejectUrl:  `${base}/api/fb-reject?token=${signToken(draftId, 'reject', secret)}`,
  };
}

export default async function handler(req, res) {
  const dryRun = req.query?.dry === '1';
  try {
    const theme = await getNextTheme(redis);
    const weekDate = new Date().toISOString().slice(0, 10);
    const systemPrompt = await loadSystemPrompt();
    const recent = await recentCaptions(4);

    let captionResult;
    try {
      captionResult = await generateCaption({
        theme,
        weekDate,
        recentCaptions: recent,
        systemPrompt,
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    } catch (err) {
      await new Promise((r) => setTimeout(r, 60_000));
      captionResult = await generateCaption({
        theme,
        weekDate,
        recentCaptions: recent,
        systemPrompt,
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }

    const draftId = randomUUID();

    let imageUrl = null;
    try {
      imageUrl = await generateImage({
        prompt: captionResult.image_prompt,
        draftId,
        openaiKey: process.env.OPENAI_API_KEY,
        blobToken: process.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch (err) {
      console.error('Image generation failed, continuing text-only:', err.message);
    }

    const draft = {
      caption: captionResult.caption,
      hashtags: captionResult.hashtags,
      image_url: imageUrl,
      theme,
      created_at: new Date().toISOString(),
      status: 'pending',
      dry_run: dryRun,
    };
    await redis.set(KEYS.draft(draftId), JSON.stringify(draft), { ex: DRAFT_TTL_SECONDS });

    const urls = actionUrls(draftId, process.env.FB_APPROVAL_SECRET);
    const html = renderApprovalEmail({
      theme,
      weekDate,
      caption: captionResult.caption,
      hashtags: captionResult.hashtags,
      imageUrl,
      ...urls,
      draftId,
      dryRun,
    });

    await sendApprovalEmail({
      apiKey: process.env.RESEND_API_KEY,
      to: process.env.OWNER_EMAIL,
      subject: `${dryRun ? 'TEST · ' : ''}FB draft for ${weekDate} — theme: ${theme}`,
      html,
    });

    await appendHistory({
      ts: new Date().toISOString(),
      theme,
      draft_id: draftId,
      status: dryRun ? 'dry_run' : 'draft_emailed',
      caption: captionResult.caption,
    });

    res.status(200).json({ ok: true, draftId, theme, dry_run: dryRun });
  } catch (err) {
    console.error('fb-draft failed:', err);
    try {
      await sendApprovalEmail({
        apiKey: process.env.RESEND_API_KEY,
        to: process.env.OWNER_EMAIL,
        subject: 'FB draft generation FAILED',
        html: `<p>Draft generation failed:</p><pre>${err.stack || err.message}</pre>`,
      });
    } catch { /* swallow */ }
    res.status(500).json({ ok: false, error: err.message });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/fb-draft.js
git commit -m "feat(fb-agent): weekly draft endpoint"
```

---

## Task 11: Smoke test — `/api/fb-draft` module loads

**Files:**
- Create: `tests/fb-draft.test.js`

Why no full integration test: mocking ESM-imported helpers (`generateCaption`, `generateImage`, `sendApprovalEmail`) requires either Node 22+'s experimental module mocking or a library like `esmock`. We chose to keep the project dep-light and rely on the manual dry-run (Task 18) as the integration test. The smoke test below catches import errors and missing exports — the most common failure mode after refactors.

- [ ] **Step 1: Write the smoke test**

Create `tests/fb-draft.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Required envs so the module's top-level Redis init doesn't throw.
process.env.UPSTASH_REDIS_REST_URL = 'http://localhost';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test';

test('fb-draft module loads and exports a default handler', async () => {
  const mod = await import('../api/fb-draft.js');
  assert.equal(typeof mod.default, 'function');
});
```

- [ ] **Step 2: Run, verify pass**

Run: `npm test`
Expected: smoke test passes.

- [ ] **Step 3: Commit**

```bash
git add tests/fb-draft.test.js
git commit -m "test(fb-agent): fb-draft import smoke test"
```

---

## Task 12: `/api/fb-approve` endpoint

**Files:**
- Create: `api/fb-approve.js`

- [ ] **Step 1: Write the endpoint**

Create `api/fb-approve.js`:

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add api/fb-approve.js
git commit -m "feat(fb-agent): approve endpoint with one-time-use enforcement"
```

---

## Task 13: `/api/fb-approve` token-rejection + smoke test

**Files:**
- Create: `tests/fb-approve.test.js`

We CAN test token rejection in isolation (no helper mocking needed), and the smoke test catches import errors. Full approve-and-post flow is exercised in the manual test-Page run (Task 19).

- [ ] **Step 1: Write the test**

Create `tests/fb-approve.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.FB_APPROVAL_SECRET = 'test-secret-32-bytes-long-aaaaaa';
process.env.UPSTASH_REDIS_REST_URL = 'http://localhost';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test';

function makeRes() {
  let statusCode, bodyText;
  return {
    setHeader() {},
    status(c) { statusCode = c; return this; },
    send(b) { bodyText = b; return this; },
    get statusCode() { return statusCode; },
    get bodyText() { return bodyText; },
  };
}

test('fb-approve module loads and exports a default handler', async () => {
  const mod = await import('../api/fb-approve.js');
  assert.equal(typeof mod.default, 'function');
});

test('fb-approve rejects missing token', async () => {
  const { default: handler } = await import('../api/fb-approve.js');
  const res = makeRes();
  await handler({ query: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('fb-approve rejects forged token', async () => {
  const { default: handler } = await import('../api/fb-approve.js');
  const res = makeRes();
  await handler({ query: { token: 'AAAA.BBBB' } }, res);
  assert.equal(res.statusCode, 401);
});

test('fb-approve rejects token with wrong action', async () => {
  const { signToken } = await import('../api/_lib/tokens.js');
  const wrong = signToken('d-1', 'reject', process.env.FB_APPROVAL_SECRET);
  const { default: handler } = await import('../api/fb-approve.js');
  const res = makeRes();
  await handler({ query: { token: wrong } }, res);
  assert.equal(res.statusCode, 401);
});
```

- [ ] **Step 2: Run tests, verify pass**

Run: `npm test`
Expected: all tests pass (tokens, themes, caption, fb-draft smoke, fb-approve).

- [ ] **Step 3: Commit**

```bash
git add tests/fb-approve.test.js
git commit -m "test(fb-agent): approve endpoint token rejection tests"
```

---

## Task 14: `/api/fb-reject` endpoint

**Files:**
- Create: `api/fb-reject.js`

- [ ] **Step 1: Write the endpoint**

Create `api/fb-reject.js`:

```js
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

  await advanceTheme(redis);
  await redis.lpush(KEYS.history, JSON.stringify({
    ts: new Date().toISOString(),
    theme: draft.theme,
    draft_id: payload.draftId,
    status: 'rejected',
  }));
  await redis.ltrim(KEYS.history, 0, 49);

  return send(res, 200, '<h1>Rejected ✓</h1><p>Theme rotation advanced. Next week tries a different angle.</p>');
}
```

- [ ] **Step 2: Commit**

```bash
git add api/fb-reject.js
git commit -m "feat(fb-agent): reject endpoint"
```

---

## Task 15: `/api/fb-edit` endpoint

**Files:**
- Create: `api/fb-edit.js`

- [ ] **Step 1: Write the endpoint**

Create `api/fb-edit.js`:

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add api/fb-edit.js
git commit -m "feat(fb-agent): edit-then-post endpoint"
```

---

## Task 16: Add cron entry to `vercel.json`

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Replace `vercel.json`**

Replace `vercel.json` contents with:

```json
{
  "buildCommand": "",
  "outputDirectory": ".",
  "crons": [
    {
      "path": "/api/sam-scraper",
      "schedule": "0 8 * * 1"
    },
    {
      "path": "/api/fb-draft",
      "schedule": "0 13 * * 1"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "chore(fb-agent): schedule weekly Monday 1pm UTC draft cron"
```

---

## Task 17: Set environment variables in Vercel

**Files:** none (Vercel dashboard / CLI action)

- [ ] **Step 1: Set all secrets via Vercel CLI**

Run each in turn (paste real values when prompted):

```bash
vercel env add ANTHROPIC_API_KEY production
vercel env add OPENAI_API_KEY production
vercel env add FB_PAGE_ACCESS_TOKEN production
vercel env add FB_PAGE_ID production
vercel env add FB_APPROVAL_SECRET production    # generate with: openssl rand -base64 32
vercel env add OWNER_EMAIL production
vercel env add PUBLIC_BASE_URL production       # e.g. https://www.montissolessentials.com
```

Expected for each: "Added Environment Variable to Project".

- [ ] **Step 2: Enable Vercel Blob storage**

In the Vercel dashboard → Storage → Create → Blob → connect to this project. This auto-injects `BLOB_READ_WRITE_TOKEN` into the project's env. No manual step beyond clicking "Create".

- [ ] **Step 3: Pull env locally to confirm**

Run: `vercel env pull .env.local`
Expected: file written with all the keys present (values redacted by Vercel for tokens).

- [ ] **Step 4: Add `.env.local` to `.gitignore` if not already**

Run: `grep -q "^\.env\.local$" .gitignore || echo ".env.local" >> .gitignore`
Run: `git diff .gitignore`
Expected: either no diff (already ignored) or adds `.env.local`.

- [ ] **Step 5: Commit if `.gitignore` changed**

```bash
git add .gitignore && git commit -m "chore: ignore .env.local" || echo "no change"
```

---

## Task 18: Deploy and run a dry-run end-to-end test

**Files:** none (verification step)

- [ ] **Step 1: Deploy**

Run: `vercel --prod`
Expected: deploy succeeds, prints production URL.

- [ ] **Step 2: Trigger a dry run**

Run: `curl -sS "https://www.montissolessentials.com/api/fb-draft?dry=1"`
Expected JSON: `{"ok":true,"draftId":"...","theme":"contracts","dry_run":true}`.

- [ ] **Step 3: Verify the email arrived**

Open your `OWNER_EMAIL` inbox. You should see "TEST · FB draft for <date> — theme: contracts" within ~60 seconds. Confirm:
- Banner reads "TEST — would post to Facebook".
- Image renders inline.
- Caption text matches brand voice.
- Three buttons (Approve/Edit/Reject) all link to `https://www.montissolessentials.com/api/fb-...?token=...`.

- [ ] **Step 4: Click "Approve & post" on the dry-run draft**

Click the button. Browser should land on a page reading "Dry run — would have posted" with the caption shown. **No real FB post happens.**

- [ ] **Step 5: Click "Approve" a second time**

Click the same link from the email again. Page should now read "Draft already used or expired" (status 410).

If any of the above fails, debug before proceeding. Do not skip to Task 19.

---

## Task 19: Live test against a throwaway Facebook Page

**Files:** none (verification step)

- [ ] **Step 1: Create a throwaway test Page**

In your Facebook account → Pages → Create new Page. Name it something like "Montissol Test (delete me)". Generate a Page Access Token for it via Meta Graph API Explorer (Facebook for Developers → Tools → Graph API Explorer → select the test page → Generate Access Token with `pages_manage_posts`, `pages_read_engagement` permissions).

- [ ] **Step 2: Swap env vars to the test Page**

```bash
vercel env rm FB_PAGE_ID production
vercel env rm FB_PAGE_ACCESS_TOKEN production
vercel env add FB_PAGE_ID production              # paste test Page ID
vercel env add FB_PAGE_ACCESS_TOKEN production    # paste test Page token
vercel --prod                                     # redeploy with new env
```

- [ ] **Step 3: Trigger a real (non-dry) draft**

Run: `curl -sS "https://www.montissolessentials.com/api/fb-draft"`
Expected: `{"ok":true,...,"dry_run":false}`.

- [ ] **Step 4: Approve from the email**

Click "Approve & post". Page should read "Posted ✓" with a Facebook post ID. Open the test Page on Facebook — confirm the post is live with image and caption.

- [ ] **Step 5: Swap back to the real Page**

```bash
vercel env rm FB_PAGE_ID production
vercel env rm FB_PAGE_ACCESS_TOKEN production
vercel env add FB_PAGE_ID production              # paste REAL Page ID
vercel env add FB_PAGE_ACCESS_TOKEN production    # paste REAL Page token
vercel --prod
```

- [ ] **Step 6: Delete the test Page**

In Facebook → Test Page → Settings → Delete Page. The cron is now wired to the real Page.

---

## Task 20: Watch the first real Monday run

**Files:** none (operational)

- [ ] **Step 1: On the first Monday after deploy**

Confirm by 9 AM ET (allowing for DST) that the draft email arrived. If it didn't:
- Check Vercel logs: `vercel logs --since 1h`
- Hit `/api/fb-status` (if implemented) or check Upstash dashboard for `fb:history` list

- [ ] **Step 2: Review the draft, approve or reject as appropriate**

If approved and posted, open the FB Page and confirm the post is live.

- [ ] **Step 3: Note any brand-voice issues**

If the caption needs tone adjustment, edit `prompts/system-prompt.md` (no code change needed) and commit:

```bash
git add prompts/system-prompt.md
git commit -m "tune(fb-agent): adjust brand voice based on first live post"
```

---

## Self-Review Checklist (run after writing this plan)

- [x] **Spec coverage** — every section of the spec maps to a task:
  - Architecture/components → Tasks 2, 7–10, 12, 14, 15
  - Theme rotation → Task 4
  - Storage schema → Tasks 2, 10, 12
  - Security (HMAC, one-time-use, secrets) → Tasks 3, 12, 17
  - Error handling → built into Tasks 10, 12, 14, 15
  - Testing → Tasks 3, 4, 5, 11, 13
  - Manual go-live → Tasks 18, 19
- [x] **No placeholders** — every code step has full code; no TBD/TODO; no "similar to Task N"
- [x] **Type consistency** — helper signatures (`generateCaption`, `generateImage`, `postToPage`, `signToken`, `verifyToken`, `getNextTheme`, `advanceTheme`) used consistently across endpoints and tests
- [x] **Frequent commits** — every task ends with at least one commit
