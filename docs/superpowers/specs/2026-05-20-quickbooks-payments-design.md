# QuickBooks Payments Integration — Design

**Date:** 2026-05-20
**Owner:** Elysee Montissol
**Status:** Approved for implementation planning

## Goal

Replace the PayPal Smart Buttons on the invoice payment page with QuickBooks Payments (Intuit), supporting both **credit/debit card** and **ACH bank transfer**, so the customer chooses their method. Primary motivation: lower processing fees — ACH (~1%, capped) versus card (~3%) on large cleaning-contract invoices.

## Non-goals (v1)

- No QuickBooks Online **accounting** sync — website payments are processed but not auto-recorded as Invoice/Payment objects in QBO. (Possible future phase.)
- No saved/stored payment methods or recurring billing.
- No multi-currency — USD only, matching the current page.
- No redesign of the invoice page beyond the payment section.
- The existing invoice-lookup feature is untouched.

## Background — current state

PayPal lives entirely in `invoice.html`:
- A payment form: name, email, invoice #, amount, memo.
- An invoice-lookup box (queries `api/invoices.js` / Upstash Redis) — independent of the payment processor.
- PayPal Smart Buttons render in `#paypal-button-container`; `createOrder` and `capture` run client-side via the PayPal JS SDK. No server involvement in the payment.
- PayPal emails the customer's receipt automatically.

QuickBooks Payments differs fundamentally: charges require a **server-side API call** with OAuth2 credentials, and the API does **not** auto-email a receipt.

## Prerequisites (user-side, outside the build)

1. **Intuit Developer app** — created (`ME Payments`). Sandbox (Development) Client ID/Secret available. Redirect URI `https://www.montissolessentials.com/api/qb-oauth` added.
2. **QuickBooks Payments merchant account** — NOT yet held. Application is in/awaiting Intuit underwriting. Sandbox testing does not require it; production go-live does.
3. Production keys require completing Intuit's "App details" + "Compliance" checklist in the developer portal — done near go-live.

## Architecture

```
invoice.html (browser)
  │  customer enters amount + card OR bank details
  │
  ├──1─▶ Intuit tokenizer ── card/bank data → single-use token
  │      (PAN & routing # never reach the Vercel server)
  │
  └──2─▶ POST /api/qb-charge   (card)    ┐
         POST /api/qb-echeck   (ACH)     ├─▶ api/_lib/qb-auth.js
                  │                      │     access token from stored
                  │                      │     refresh token (Upstash)
                  ▼                      ┘
         QuickBooks Payments API
         /v4/payments/charges  |  /v4/payments/echecks
                  │
                  ├─▶ success → api/_lib/qb-receipt.js → receipt email (Resend)
                  └─▶ {ok, txnId, status} → browser success screen

One-time: GET /api/qb-oauth  — OAuth2 authorization-code callback,
          stores the initial refresh token in Upstash.
```

**Stack** — consistent with the existing site:

| Concern | Tool | In project already? |
|---------|------|---------------------|
| Serverless functions | Vercel `api/*.js` | Yes |
| Token / refresh-token storage | Upstash Redis (`@upstash/redis`) | Yes |
| Receipt + alert email | Resend (`resend`) | Yes |
| QuickBooks Payments API | REST over `fetch` | New (no SDK needed) |
| OAuth2 with Intuit | REST over `fetch` | New |

## Components

### Client — `invoice.html` (modified)

Remove: PayPal SDK `<script>`, `initPayPal()`, `#paypal-button-container`, all PayPal-branded copy.

Add a payment-method segmented toggle (**Card** / **Bank transfer**) and two field panels:

- **Card panel** (default): card number, expiry (MM/YY), CVC, billing ZIP.
- **Bank panel**: routing #, account #, account type (checking/savings radio), account holder name, and an **ACH authorization checkbox** with the language: *"I authorize Montissol Essentials LLC to electronically debit my account for the amount shown above."*

One **"Pay $X.XX"** button replaces the PayPal buttons; its label tracks the entered amount live. In the Bank panel the button is disabled until the authorization checkbox is ticked.

The existing name/email/invoice#/amount/memo fields and the invoice-lookup box are unchanged. Page keeps its current CSS/visual style.

Client JS flow:
1. Validate the form (existing `validateForm` extended for the new fields).
2. Send card/bank data to the Intuit tokenizer → single-use token. Sensitive numbers never reach the Vercel server.
3. POST `{ token, amount, name, email, invoice, memo }` to `/api/qb-charge` (card) or `/api/qb-echeck` (ACH).
4. On `{ok:true}` → show the success screen (two variants, below). On error → inline message, form stays filled.

### `api/_lib/qb-auth.js` — OAuth2 token management

- `getAccessToken()` — returns a valid access token. Reads cached `qb:access_token` from Redis; if absent/expired, exchanges the stored `qb:refresh_token` for a new access token via Intuit's token endpoint, caches it (~55-min TTL).
- Intuit **rotates** the refresh token: when the token response contains a new refresh token, immediately write it back to `qb:refresh_token`.
- On a refresh failure: retry once. If the refresh token is rejected as expired/revoked, throw a distinct `QBReauthorizationError` so callers can surface the re-auth path and trigger the alert email.
- Reads `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_ENVIRONMENT` from env.

### `api/qb-oauth.js` — one-time authorization callback

- Handles the OAuth2 authorization-code redirect from Intuit.
- Exchanges the `code` for the initial access + refresh token; stores the refresh token in Redis.
- Verifies the OAuth `state` parameter to prevent CSRF on the callback.
- Run once at setup; shows a simple "QuickBooks connected" confirmation page.

### `api/qb-charge.js` — card charge endpoint

- Accepts POST `{ token, amount, name, email, invoice, memo }`.
- Validates amount (> 0, numeric, 2-decimal) server-side; rejects bad input with 400.
- `getAccessToken()`, then POST to QuickBooks Payments `/v4/payments/charges`: amount, `currency: USD`, the card token, `capture: true`, a description built from invoice/memo, and a unique `Request-Id` header for idempotency.
- Success → call `qb-receipt.js` to email the customer → return `{ ok:true, txnId, status:'CAPTURED' }`.
- Decline/error → return `{ ok:false, message }` with a customer-safe message; status 402 for declines, 502 for upstream errors.

### `api/qb-echeck.js` — ACH charge endpoint

- Accepts POST `{ token, amount, name, email, invoice, memo }`.
- Same validation and access-token logic.
- POST to `/v4/payments/echecks` with the bank token, amount, and the ACH authorization indicator.
- ACH returns a **pending** status (settles in ~3–5 business days), not an instant capture.
- Success → receipt email noting "pending / processing" → return `{ ok:true, txnId, status:'PENDING' }`.

### `api/_lib/qb-receipt.js` — receipt email

- Renders and sends a payment receipt via Resend: amount, transaction ID, invoice #, memo, date, and method.
- Card receipt: "Payment received." ACH receipt: "Bank payment submitted — will process within 3–5 business days."
- A receipt-send failure never fails the payment — it is logged and swallowed.

### `api/_lib/qb-client.js` — shared QuickBooks request helper

- Thin wrapper for QuickBooks Payments API calls: base URL by environment (sandbox vs production), auth header, `Request-Id` header, JSON parse, and uniform error extraction (decline reason vs system error).

## Payment flows

**Card (instant):** form → tokenize → `/api/qb-charge` → `/v4/payments/charges` (`capture:true`) → receipt email → "Payment Received" + transaction ID.

**ACH (pending):** form (+ authorization checkbox) → tokenize → `/api/qb-echeck` → `/v4/payments/echecks` → receipt email → "Bank Payment Submitted — processing in 3–5 business days" + transaction ID.

## Storage (Upstash Redis)

| Key | Contents | TTL |
|-----|----------|-----|
| `qb:refresh_token` | current OAuth2 refresh token (rotates on use) | none |
| `qb:access_token` | cached access token | ~55 min |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `QB_CLIENT_ID` | Intuit app client ID |
| `QB_CLIENT_SECRET` | Intuit app client secret |
| `QB_ENVIRONMENT` | `sandbox` or `production` — selects API base URLs |
| `QB_REALM_ID` | QuickBooks company ID |
| `QB_OAUTH_STATE_SECRET` | secret for signing/verifying the OAuth `state` parameter |
| `OWNER_EMAIL` | recipient for the re-authorization alert email |
| `RESEND_API_KEY` | already set — used for receipt + alert email |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | already set |

Sandbox keys are used while `QB_ENVIRONMENT=sandbox`; production keys swapped in at go-live.

## PCI scope

Card and bank data are tokenized **client-side, browser-to-Intuit** — the Vercel server never receives a PAN or full account/routing number. This targets the lightest PCI tier (SAQ-A / SAQ-A-EP). **Open verification item:** the exact QuickBooks Payments client-side tokenization mechanism (a hosted-fields SDK vs a direct browser POST to the Intuit tokens endpoint) and the resulting SAQ tier must be confirmed against current Intuit documentation during planning. If no clean browser tokenizer exists, the design must be revisited before implementation — server-side card handling would massively expand PCI scope and is out of scope.

## Error handling

| Failure | Behavior |
|---------|----------|
| Card declined | `/v4/payments/charges` decline → relay a customer-safe reason → 402 → inline message, form retained |
| Tokenization fails (bad card/bank number) | Caught client-side before any server call — inline field error |
| Invalid routing/account number (ACH) | QuickBooks rejects → "Please check your bank details" message |
| Double submit | Unique `Request-Id` per attempt + button disabled on submit → no double charge |
| Access token refresh fails | `qb-auth.js` retries once; persistent failure → "payment system temporarily unavailable" |
| Refresh token expired/revoked | `QBReauthorizationError` → endpoint returns generic unavailable message to customer + sends re-authorization alert email to `OWNER_EMAIL` |
| Receipt email fails | Logged and swallowed — the payment already succeeded; success screen still shown |
| QuickBooks API down / network error | "Payment could not be completed, no charge was made — please try again" |

Principle: a successful charge is never shown as failure; a failed charge is never shown as success. Every attempt is logged with its outcome and transaction ID.

## Testing

**Unit tests** (Node built-in `node:test`):
- Amount validation — rejects ≤ 0, non-numeric, over-long; formats to 2 decimals.
- `qb-auth.js` token refresh — mints access token from refresh token, caches it, writes back a rotated refresh token (mocked Intuit responses).
- Charge/eCheck request shaping — correct payload (amount, currency, token, `Request-Id`) from form input.
- Decline handling — a mocked QuickBooks decline yields the correct customer-facing message.
- `QBReauthorizationError` — a rejected refresh token triggers the distinct error type.

**Integration tests (Intuit sandbox):**
- Real sandbox calls with Intuit test card numbers and test bank accounts — success, decline, and ACH-pending paths.

**Manual go-live checklist:**
1. Sandbox card payment → "Payment Received", receipt email arrives, transaction visible in sandbox QuickBooks.
2. Sandbox ACH payment → "Bank Payment Submitted" pending screen.
3. Sandbox decline → correct error message, no charge.
4. After QuickBooks Payments merchant account is approved: swap env vars to production keys, complete the Intuit production checklist, run one small real card payment, confirm funds settle.

**Not automated:** real production payments — verified once, manually, with a small live transaction.

## Open questions resolved during brainstorming

1. Motivation → lower processing fees.
2. Methods → both ACH and card, customer chooses.
3. QuickBooks accounts → QuickBooks Online held; QuickBooks Payments not yet (in underwriting).
4. QBO accounting sync → out of scope for v1 (process-only).
5. Re-authorization alert email → included.

## Implementation order (preview for the plan)

1. `qb-client.js` — shared request helper + environment base URLs.
2. `qb-auth.js` — OAuth2 token management + refresh-token rotation + unit tests.
3. `qb-oauth.js` — one-time authorization callback.
4. `qb-charge.js` — card endpoint + unit tests.
5. `qb-echeck.js` — ACH endpoint + unit tests.
6. `qb-receipt.js` — receipt email.
7. `invoice.html` — remove PayPal, add method toggle + card/bank panels + client JS.
8. Sandbox integration testing (card, ACH, decline).
9. One-time OAuth authorization against sandbox.
10. Production go-live after merchant-account approval.
