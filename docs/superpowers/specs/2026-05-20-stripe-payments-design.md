# Stripe Payments Integration — Design

**Date:** 2026-05-20
**Owner:** Elysee Montissol
**Status:** Approved for implementation planning

## Goal

Replace the PayPal Smart Buttons on the invoice payment page with Stripe, supporting both **credit/debit card** and **ACH bank transfer**, so the customer chooses their method. Primary motivation: lower processing fees — Stripe ACH is ~0.8% capped at $5, versus ~3% for cards, a large saving on big cleaning-contract invoices.

## History

Originally scoped against QuickBooks Payments. Research during planning found QuickBooks Payments has no browser-side tokenizer (no equivalent of Stripe.js / hosted fields) — card data would have to pass through our own server, escalating PCI compliance from SAQ-A to SAQ-D. That is out of scope for a small business to self-manage. The project pivoted to Stripe, which provides genuine in-browser tokenization (SAQ-A) and cheaper ACH. The superseded QuickBooks spec remains in git history.

## Non-goals (v1)

- No accounting-system sync — payments are processed but not auto-recorded in QuickBooks Online or elsewhere.
- No saved payment methods, no recurring billing.
- No custom Stripe webhook handler — Stripe's Dashboard and built-in email notifications cover ACH settlement/failure. A webhook can be added later if in-app handling is wanted.
- No multi-currency — USD only.
- No redesign of the invoice page beyond the payment section.
- The existing invoice-lookup feature is untouched.

## Background — current state

PayPal lives entirely in `invoice.html`:
- A payment form: name, email, invoice #, amount, memo.
- An invoice-lookup box (queries `api/invoices.js` / Upstash Redis) — independent of the payment processor.
- PayPal Smart Buttons render in `#paypal-button-container`; `createOrder` and `capture` run client-side via the PayPal JS SDK. No server involvement in the payment.

## Architecture

```
invoice.html (browser)
  │  Stripe.js + Payment Element (one widget: Card + US bank account)
  │  Stripe tokenizes card/bank data in-browser — our server never
  │  sees a PAN or account number → PCI SAQ-A
  │
  ├──▶ GET  /api/stripe-config  → { publishableKey }   (page load)
  │
  └──▶ POST /api/stripe-intent  → creates a Stripe PaymentIntent for the
                                  entered amount → { clientSecret }
            │
            ▼
       stripe.confirmPayment(elements, clientSecret, return_url)
            │
            ├─ card → status "succeeded" immediately
            └─ ACH  → status "processing" (settles in 3-5 business days)
       Stripe emails the customer's receipt automatically.
       Browser redirects to return_url → success screen reads the status.
```

**Stack:**

| Concern | Tool | In project already? |
|---------|------|---------------------|
| Serverless functions | Vercel `api/*.js` | Yes |
| Payments API + SDK | `stripe` npm package (server) | New |
| Browser payment UI | Stripe.js + Payment Element | New |

No Upstash Redis, no Resend, no OAuth — the Stripe integration needs none of them. Stripe uses a static secret API key (no token rotation) and sends receipts itself.

## Components

### Client — `invoice.html` (modified)

Remove: PayPal SDK `<script>`, `initPayPal()`, `#paypal-button-container`, all PayPal-branded copy.

Add: the Stripe.js `<script>` (`https://js.stripe.com/v3/`) and a `<div id="payment-element">` mount point. The Payment Element renders both a Card option and a US-bank-account option in one widget; for ACH it runs Stripe's instant bank-verification flow (Financial Connections) and shows the ACH authorization mandate text automatically.

The existing name/email/invoice#/amount/memo fields and the invoice-lookup box are unchanged. The page keeps its current CSS/visual style. The PayPal buttons are replaced by a single **"Pay $X.XX"** button whose label tracks the entered amount.

Client JS flow (Stripe deferred-PaymentIntent pattern, required for a customer-entered amount):
1. On load: `GET /api/stripe-config` → publishable key → `const stripe = Stripe(publishableKey)`.
2. Create Elements in deferred mode: `stripe.elements({ mode: 'payment', amount: <cents>, currency: 'usd', paymentMethodTypes: ['card', 'us_bank_account'] })`. Mount the Payment Element into `#payment-element`.
3. When the amount field changes, call `elements.update({ amount: <cents> })`.
4. On "Pay": run the existing `validateForm()`, then `await elements.submit()`.
5. `POST /api/stripe-intent` with `{ amount, name, email, invoice, memo }` → `{ clientSecret }`.
6. `stripe.confirmPayment({ elements, clientSecret, confirmParams: { return_url } })`. Stripe tokenizes, runs any bank-verification step, and redirects to `return_url`.
7. On return, `invoice.html` detects the `payment_intent_client_secret` query param, calls `stripe.retrievePaymentIntent()`, and shows the success screen by status: `succeeded` → "Payment Received"; `processing` → "Bank Payment Submitted — processing in 3-5 business days"; other → error message, form retained.

### `api/stripe-config.js`

`GET` → returns `{ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY }`. Keeps the test↔live switch purely in environment variables — no HTML edit needed to go live.

### `api/stripe-intent.js`

`POST` with `{ amount, name, email, invoice, memo }`.
- Validates `amount` server-side: numeric, > 0, within a sane maximum; converts dollars to integer cents.
- Creates a PaymentIntent via the `stripe` SDK:
  - `amount` (cents), `currency: 'usd'`
  - `payment_method_types: ['card', 'us_bank_account']`
  - `receipt_email`: the customer's email (Stripe sends the receipt)
  - `description`: built from invoice # / memo
  - `metadata`: `{ customer_name, invoice, memo }`
- Returns `{ clientSecret: paymentIntent.client_secret }`.
- On invalid input → 400 with a safe message. On a Stripe API error → 502 with a generic message.
- Reads `STRIPE_SECRET_KEY` from env.

### `api/_lib/amount.js`

Small shared helper: `parseAmountToCents(input)` — validates and converts a dollar amount to integer cents, throwing a descriptive error on invalid input. Unit-tested; used by `stripe-intent.js`.

## Payment flows

**Card (instant):** form → Payment Element → `elements.submit()` → create PaymentIntent → `confirmPayment` → Stripe tokenizes the card in-browser → status `succeeded` → "Payment Received" + payment-intent ID.

**ACH (pending):** form → Payment Element (bank option) → instant bank verification via Stripe's popup → `confirmPayment` → status `processing` → "Bank Payment Submitted — processing in 3-5 business days" + payment-intent ID. Final settlement happens asynchronously; the owner sees it in the Stripe Dashboard and via Stripe's built-in email notifications.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Server-side Stripe API key (`sk_test_…` for build, `sk_live_…` at go-live) |
| `STRIPE_PUBLISHABLE_KEY` | Browser Stripe key (`pk_test_…` / `pk_live_…`) — served by `/api/stripe-config` |

The publishable key is not secret (it is designed to be exposed in the browser). The secret key is never sent to the browser and never committed.

## PCI scope

Card and bank data are entered into the Stripe Payment Element — an iframe served by Stripe — and tokenized browser-to-Stripe. Our Vercel server never receives a PAN or bank account number, only a PaymentIntent client secret and, afterward, a payment-intent ID. This qualifies for PCI **SAQ-A**, the lightest tier (a self-assessment questionnaire, no audits or scans).

## Error handling

| Failure | Behavior |
|---------|----------|
| Invalid amount submitted | `stripe-intent.js` returns 400; client shows an inline amount error; no PaymentIntent created |
| Card declined | `confirmPayment` returns a Stripe error; the page shows Stripe's customer-safe decline message; form retained for retry |
| Bank verification cancelled / fails (ACH) | `confirmPayment` returns an error; inline message; no charge |
| `elements.submit()` validation error | Stripe reports incomplete fields inline within the Element; no server call |
| Stripe API error creating the PaymentIntent | `stripe-intent.js` returns 502; client shows "payment could not be started — please try again or contact us" |
| Network error mid-payment | Generic "payment could not be completed — please try again"; the PaymentIntent is not confirmed, so no charge |
| Duplicate submit | The Pay button disables on submit; a PaymentIntent confirmed once cannot be re-confirmed |

Principle: a successful payment is never shown as a failure; a failed/incomplete payment is never shown as success. The success screen always derives its wording from the retrieved PaymentIntent status, not from an assumption.

## Testing

**Unit tests** (Node built-in `node:test`):
- `parseAmountToCents` — accepts valid amounts, converts dollars→cents correctly, rejects ≤ 0, non-numeric, and over-maximum input.
- `stripe-intent.js` request shaping — builds the correct PaymentIntent arguments (amount in cents, currency, payment_method_types, receipt_email, description, metadata) from form input, with the Stripe SDK mocked.
- `stripe-intent.js` validation — bad input yields 400; mocked Stripe error yields 502.
- `stripe-config.js` — returns the publishable key from env.

**Integration tests (Stripe test mode):**
- Real calls to Stripe test mode with test card `4242 4242 4242 4242` (success) and `4000 0000 0000 0002` (decline).
- ACH path with Stripe's test US bank account, exercising the `processing` status.

**Manual go-live checklist:**
1. Test mode: pay with `4242…` → "Payment Received", payment visible in the Stripe test Dashboard, receipt behavior confirmed.
2. Test mode: pay by ACH with the test bank account → "Bank Payment Submitted" processing screen.
3. Test mode: pay with the decline card → correct error message, no charge.
4. Go live: switch `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` env vars to the live keys, redeploy, run one small real card payment, confirm it appears in the live Dashboard and funds settle.

**Not automated:** real live-mode payments — verified once, manually, with a small transaction.

## Open questions resolved during brainstorming

1. Motivation → lower processing fees.
2. Methods → both ACH and card, customer chooses.
3. Accounting sync → out of scope for v1 (process-only).
4. Processor → pivoted from QuickBooks to Stripe after the PCI/tokenization finding.
5. ACH bank verification → instant verification (Financial Connections), handled inside the Payment Element.

## Implementation order (preview for the plan)

1. `api/_lib/amount.js` — `parseAmountToCents` + unit tests.
2. `api/stripe-config.js` — publishable-key endpoint + unit test.
3. `api/stripe-intent.js` — PaymentIntent creation + unit tests (mocked SDK).
4. `invoice.html` — remove PayPal, add Stripe.js + Payment Element + deferred-intent client flow + success-screen status handling.
5. Stripe test-mode integration testing (card success, card decline, ACH).
6. Go live: swap env vars to live keys, redeploy, one small real transaction.
