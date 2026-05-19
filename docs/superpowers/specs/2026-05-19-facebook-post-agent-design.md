# Facebook Post Agent — Design

**Date:** 2026-05-19
**Owner:** Elysee Montissol
**Status:** Approved for implementation planning

## Goal

A weekly autonomous agent that drafts a Facebook post for the Montissol Essentials Page, emails the draft to the owner for review, and posts to Facebook on a single-click approval. Rotates between three content themes so the page mixes contract/capability messaging, recruiting, and community/brand content.

## Non-goals

- Multi-page support (single Page only)
- AI-driven comment moderation or reply automation
- Analytics dashboard (Facebook Page Insights is sufficient)
- Image moderation (the human approval step is the moderator)
- Cross-posting to Instagram, LinkedIn, X, etc.

## Architecture

```
                 (Mon 8am ET, weekly)
Vercel cron ─────────▶ /api/fb-draft
                          │
                          ├─▶ Anthropic API   ── caption (Claude Sonnet 4.6)
                          ├─▶ OpenAI API      ── image (gpt-image-1, 1024×1024)
                          ├─▶ Upstash Redis   ── save draft + signed token
                          └─▶ Resend          ── email draft to owner
                                                  │
                                       Owner clicks button in email
                                                  │
                  ┌───────────────────────────────┼─────────────────────────────┐
                  ▼                               ▼                             ▼
        /api/fb-approve?token=…         /api/fb-edit?token=…       /api/fb-reject?token=…
                  │                               │                             │
                  ▼                               ▼                             ▼
        Meta Graph POST /photos       HTML edit form → POST →      Mark rejected,
        Mark used, rotate theme       Graph API → mark used        rotate theme
```

**Stack** — reuses what's already in [package.json](../../../package.json) and [vercel.json](../../../vercel.json):

| Concern | Tool | Already in project? |
|---------|------|---------------------|
| Cron trigger | Vercel cron | Yes (sam-scraper) |
| Storage | Upstash Redis (`@upstash/redis`) | Yes |
| Email | Resend (`resend`) | Yes |
| Caption LLM | Anthropic SDK (`@anthropic-ai/sdk`) | New |
| Image gen | OpenAI SDK (`openai`) | New |
| Image storage | Vercel Blob (`@vercel/blob`) | New |
| Facebook posting | Meta Graph API (raw `fetch`) | New |

## Components

### 1. `/api/fb-draft.js` — weekly draft generator

**Trigger:** Vercel cron `0 13 * * 1` (Monday 13:00 UTC). Local time: 08:00 ET during EST (winter), 09:00 ET during EDT (summer) — small DST drift is acceptable for an 8 AM target. Also accepts manual GET with `?dry=1` query for test runs.

**Flow:**
1. Read `fb:next_theme` from Redis (default `contracts`).
2. Read last 4 captions from `fb:history` for de-duplication context.
3. Call Anthropic with system prompt (company profile + brand-voice rules) and user prompt (theme + week date + recent captions).
4. Expect JSON output: `{ caption: string, image_prompt: string, hashtags: string[] }`. If parsing fails, retry once with a stricter prompt; second failure → email "draft generation failed" alert.
5. Call OpenAI `gpt-image-1` with `image_prompt`. Decode the returned base64 and upload the binary to **Vercel Blob** (`@vercel/blob`) at path `fb-drafts/{draftId}.png` with a 7-day expiry. On any failure, continue with text-only.
6. Generate draft ID (`crypto.randomUUID()`).
7. Sign three tokens (approve / edit / reject) using HMAC-SHA256 with `FB_APPROVAL_SECRET`. Each token encodes `{draftId, action}`.
8. Store draft in Redis under `fb:draft:{draftId}` with 72-hour TTL:
   ```json
   {
     "caption": "...",
     "hashtags": ["...", "..."],
     "image_url": "https://...vercel-storage.com/fb-drafts/{draftId}.png",  // omitted if image gen failed
     "theme": "contracts",
     "created_at": "2026-05-18T13:00:00Z",
     "status": "pending"
   }
   ```
   **Why Vercel Blob, not base64 in Redis:** Upstash Redis has a 1 MB per-value limit on the free tier; a 1024×1024 PNG can run 1–3 MB base64-encoded. Vercel Blob is the right storage primitive for a small binary on a 72h lifecycle, integrates natively with Vercel, and costs cents per month at this volume.
9. Email via Resend: rendered HTML with inline image preview, caption text, and the three signed action URLs.
10. Log run to `fb:history` (list, capped at 50 entries): `{ts, theme, draft_id, status: "draft_emailed"}`.

**Dry-run mode (`?dry=1`):** Steps 1–8 unchanged. Step 9 email subject prefixed with "TEST". Step 10 logged with `status: "dry_run"`. Approve endpoint, when hit with a dry-run draft, returns "would have posted" without calling Graph API.

### 2. `/api/fb-approve.js` — one-click post

**Flow:**
1. Verify HMAC on `?token=`. Invalid → 401.
2. Atomic `GETDEL` on `fb:draft:{draftId}`. Missing → "Already used or expired" page.
3. If draft `status !== "pending"`, refuse.
4. POST to Meta Graph API:
   - With image: `POST https://graph.facebook.com/v21.0/{FB_PAGE_ID}/photos` with `message=caption + hashtags` and `url=image_url` (the Vercel Blob URL).
   - Without image: `POST /{FB_PAGE_ID}/feed` with `message`.
   - Auth: `access_token={FB_PAGE_ACCESS_TOKEN}`.
5. On 2xx: append `fb:history` entry `{status: "posted", fb_post_id}`. Increment `fb:next_theme` to next in rotation. Return HTML "Posted ✓" confirmation page with link to the FB post.
6. On 4xx/5xx: re-store draft in Redis (so it can be retried), append `fb:history` entry with error, return error page showing FB's error message.

### 3. `/api/fb-edit.js` — edit-then-post

**GET:** Verify token, fetch draft, render an HTML form with the caption in a textarea and the image preview. Submit POSTs to the same endpoint.
**POST:** Replace caption in draft, then perform the same posting flow as `/api/fb-approve` (skipping HMAC re-check since the GET already validated; use a per-session form CSRF token).

### 4. `/api/fb-reject.js` — discard draft

**Flow:** Verify token, delete draft from Redis, append `fb:history` entry `{status: "rejected"}`, advance `fb:next_theme` (so the next week tries a different angle), return "Rejected" page.

### 5. `/api/fb-status.js` — health check (optional)

Returns JSON of last 12 `fb:history` entries plus the next scheduled run. Useful for spot-checking; not linked from anywhere.

## Content strategy

**Theme rotation** (stored in `fb:next_theme`, cycles in this order):

| # | Theme | Source material | Tone |
|---|-------|-----------------|------|
| 1 | `contracts` | `company-profile.md` capabilities, past performance, NAICS codes | Federal-professional, capability-focused |
| 2 | `recruiting` | Open roles in `job-*.html` files (rotates which role each cycle) | Direct, mission-focused, includes apply link |
| 3 | `community` | Port St. Lucie, Florida, industry insights, team appreciation, seasonal/holiday | Warmer, still professional, brand-building |

**Brand-voice rules** (baked into system prompt):
- Tone: professional, federal-facing, confident but not boastful
- No emojis except sparingly on community-theme posts (max 1)
- Max 3 relevant hashtags
- Caption length: 80–250 words (Facebook truncates around 477 chars on mobile feed without "See more"; first 80 words must carry the message)
- Never invent contracts, certifications, or capabilities not in `company-profile.md`
- Always include a CTA appropriate to the theme (capabilities → "Reach out via MontissolEssentials.com", recruiting → apply link, community → soft CTA or none)

**De-duplication:** The last 4 captions are passed to the LLM in the user prompt with instruction "do not repeat the same hooks, phrases, or angles as these recent posts."

## Storage schema (Upstash Redis)

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `fb:draft:{uuid}` | JSON string | 72h | Pending draft awaiting approval |
| `fb:next_theme` | string | none | One of `contracts` / `recruiting` / `community` |
| `fb:history` | list (capped 50) | none | Audit log of all weekly runs |
| `fb:recruiting_next_role` | string | none | Cycles which job listing to feature on recruiting weeks |

## Security

- **Approval tokens** — HMAC-SHA256(`{draftId}|{action}`, secret=`FB_APPROVAL_SECRET`). Verified before any Redis read. Forgery → 401.
- **One-time use** — atomic `GETDEL` on draft key ensures double-click can't double-post.
- **Token TTL** — drafts auto-expire after 72h; stale tokens return "expired" page.
- **No PII in logs** — `fb:history` stores captions but not email contents or tokens.
- **Secrets in Vercel env vars only:**
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `FB_PAGE_ACCESS_TOKEN` (long-lived Page token)
  - `FB_PAGE_ID`
  - `FB_APPROVAL_SECRET` (32+ bytes random)
  - `BLOB_READ_WRITE_TOKEN` (Vercel Blob, auto-set when you enable Blob storage)
  - `RESEND_API_KEY` (already set)
  - `OWNER_EMAIL` (where drafts are sent)

## Error handling

| Failure | Behavior |
|---------|----------|
| Anthropic API error | Retry once after 60s. Second failure → email "draft generation failed". |
| OpenAI image gen error | Fall back to text-only; note in email. |
| Caption JSON parse error | Retry once with stricter prompt. Second failure → email failure alert. |
| FB Graph API error on post | Re-store draft in Redis, return error page, log to history, alert email. |
| FB token health check fails before post | Send "refresh your Page token" alert instead of a draft. |
| Approval token forged | 401, no DB read. |
| Approval token already used | "Already posted at {time}" page. |
| Draft expired (>72h) | "Draft expired" page; no fallback posting. |
| Redis unavailable | Cron logs error to Vercel; no email sent. Operator notices missing Monday email. |

## Testing

**Unit tests** (Node's built-in `node:test` runner — the project has no test framework today, so this avoids a new dependency):
- HMAC sign/verify (valid passes, forged rejected, wrong action rejected)
- Theme rotation (advances correctly on approve and reject; does not advance on draft generation)
- Caption JSON parsing (handles markdown fences, missing optional fields)
- Token one-time-use (second use rejected)

**Integration tests:**
- `/api/fb-draft?dry=1` end-to-end against a test Redis namespace, mocked Anthropic/OpenAI responses, mocked Resend
- Approve endpoint with dry-run draft returns "would have posted" without Graph API call

**Manual go-live procedure:**
1. Run `/api/fb-draft?dry=1` manually → confirm email arrives correctly.
2. Click "Approve & post" in dry-run mode → confirm no FB call, "would have posted" response.
3. Switch `FB_PAGE_ID` to a throwaway test Page, run live → confirm post lands on test Page.
4. Switch `FB_PAGE_ID` back to the real Page; enable the weekly cron in `vercel.json`.

**Out of scope for automated tests:** Real Meta Graph API calls (too risky in CI). The Graph API integration is covered only by the manual test-Page run.

## Open questions resolved during brainstorming

1. ✅ Goal of posts → mix of contracts / recruiting / community (rotating themes)
2. ✅ Autonomy → draft for approval (not fully autonomous)
3. ✅ Delivery → email with magic-link approval (not reply-parsing)
4. ✅ Images → AI-generated per post (gpt-image-1)
5. ✅ Schedule → Monday 8 AM ET
6. ✅ Facebook setup → Page + Dev App + long-lived Page Access Token already exist

## Estimated cost

Per post: ~$0.06 (Claude caption $0.02 + OpenAI image $0.04). Annual: ~$3.
Vercel cron, Upstash Redis, Resend stay within existing free/paid tiers.

## Implementation order (preview for the plan)

1. Token signing/verifying helper + unit tests
2. Theme rotation helper + unit tests
3. `/api/fb-draft` with mocked external services + integration test
4. `/api/fb-approve` with mocked Graph API + tests
5. `/api/fb-reject`
6. `/api/fb-edit`
7. Wire up real Anthropic + OpenAI + Resend
8. Manual dry-run end-to-end
9. Manual test-Page live run
10. Enable cron in `vercel.json` for the real Page
