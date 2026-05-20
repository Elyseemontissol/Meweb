# Stripe Payments Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PayPal Smart Buttons on `invoice.html` with Stripe — a Payment Element accepting both card and ACH bank transfer, backed by two small Vercel serverless functions.

**Architecture:** The browser loads Stripe.js and mounts a Payment Element (card + US bank account in one widget). `GET /api/stripe-config` returns the publishable key; `POST /api/stripe-intent` creates a Stripe PaymentIntent for the customer-entered amount and returns its client secret. Stripe tokenizes card/bank data in-browser (PCI SAQ-A) and emails the receipt. Card payments succeed instantly; ACH payments go to `processing` and settle in days.

**Tech Stack:** Node.js 20 (ES modules) · Vercel serverless · `stripe` Node SDK · Stripe.js + Payment Element · Node built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-05-20-stripe-payments-design.md`

**Working directory for all paths:** `MontissolEssentials/` (the project root with `package.json`). Branch: `feat/stripe-payments`.

---

## File Structure

**New files:**

| File | Responsibility |
|------|----------------|
| `api/_lib/amount.js` | `parseAmountToCents` — validate a dollar amount, convert to integer cents |
| `api/stripe-config.js` | `GET` — return the Stripe publishable key from env |
| `api/stripe-intent.js` | `POST` — validate input, create a Stripe PaymentIntent, return its client secret |
| `tests/amount.test.js` | Unit tests for `parseAmountToCents` |
| `tests/stripe-config.test.js` | Unit test for the config endpoint |
| `tests/stripe-intent.test.js` | Unit tests for request shaping + input validation |

**Modified files:**

| File | Change |
|------|--------|
| `package.json` | Add `stripe` dependency |
| `invoice.html` | Remove PayPal SDK + button code; add Stripe.js, a Payment Element, and the client payment flow |

---

## Task 1: Add the `stripe` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current package.json**

Run: `cat package.json`
Expected: a `dependencies` object (currently includes `@anthropic-ai/sdk`, `@upstash/redis`, `@vercel/blob`, `openai`, `resend`).

- [ ] **Step 2: Add `stripe` to dependencies**

Add `"stripe": "^17.0.0"` to the `dependencies` object, keeping the existing entries and alphabetical order. Do not change any other field.

- [ ] **Step 3: Install**

Run: `npm install`
Expected: lockfile updates, `stripe` installed, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add stripe dependency for payments integration"
```

---

## Task 2: `parseAmountToCents` helper

**Files:**
- Create: `tests/amount.test.js`
- Create: `api/_lib/amount.js`

- [ ] **Step 1: Write the failing test**

Create `tests/amount.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountToCents } from '../api/_lib/amount.js';

test('converts whole dollars to cents', () => {
  assert.equal(parseAmountToCents(10), 1000);
  assert.equal(parseAmountToCents('1'), 100);
});

test('converts decimal dollars to cents', () => {
  assert.equal(parseAmountToCents('19.99'), 1999);
  assert.equal(parseAmountToCents(2500.5), 250050);
});

test('rejects amounts below $1', () => {
  assert.throws(() => parseAmountToCents(0));
  assert.throws(() => parseAmountToCents('0.50'));
  assert.throws(() => parseAmountToCents(-5));
});

test('rejects non-numeric input', () => {
  assert.throws(() => parseAmountToCents('abc'));
  assert.throws(() => parseAmountToCents(''));
  assert.throws(() => parseAmountToCents(NaN));
  assert.throws(() => parseAmountToCents(undefined));
});

test('rejects amounts over the maximum', () => {
  assert.throws(() => parseAmountToCents(100001));
});

test('accepts the maximum boundary', () => {
  assert.equal(parseAmountToCents(100000), 10000000);
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test`
Expected: `amount.test.js` fails — module `../api/_lib/amount.js` not found.

- [ ] **Step 3: Implement the helper**

Create `api/_lib/amount.js`:

```js
const MAX_AMOUNT_CENTS = 100000 * 100; // $100,000 sanity cap

export function parseAmountToCents(input) {
  const num = typeof input === 'number' ? input : parseFloat(input);
  if (!Number.isFinite(num)) {
    throw new Error('Amount must be a valid number.');
  }
  if (num < 1) {
    throw new Error('Amount must be at least $1.00.');
  }
  const cents = Math.round(num * 100);
  if (cents > MAX_AMOUNT_CENTS) {
    throw new Error('Amount exceeds the maximum allowed.');
  }
  return cents;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: all 6 amount tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/amount.js tests/amount.test.js
git commit -m "feat(payments): amount validation helper"
```

---

## Task 3: `/api/stripe-config` endpoint

**Files:**
- Create: `tests/stripe-config.test.js`
- Create: `api/stripe-config.js`

- [ ] **Step 1: Write the failing test**

Create `tests/stripe-config.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeRes() {
  let statusCode, body;
  return {
    status(c) { statusCode = c; return this; },
    json(b) { body = b; return this; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
}

test('returns the publishable key from env', async () => {
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_abc123';
  const { default: handler } = await import('../api/stripe-config.js');
  const res = makeRes();
  handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.publishableKey, 'pk_test_abc123');
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test`
Expected: `stripe-config.test.js` fails — module not found.

- [ ] **Step 3: Implement the endpoint**

Create `api/stripe-config.js`:

```js
export default function handler(req, res) {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Stripe publishable key is not configured.' });
  }
  res.status(200).json({ publishableKey: key });
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: the config test passes; all earlier tests still pass.

- [ ] **Step 5: Commit**

```bash
git add api/stripe-config.js tests/stripe-config.test.js
git commit -m "feat(payments): stripe publishable-key config endpoint"
```

---

## Task 4: `/api/stripe-intent` endpoint

**Files:**
- Create: `tests/stripe-intent.test.js`
- Create: `api/stripe-intent.js`

The Stripe SDK call is isolated in the handler; the testable logic — building the PaymentIntent parameters — is extracted into the pure function `buildPaymentIntentParams`, unit-tested directly. The handler's input-validation paths (400 / 405) are tested without touching Stripe because validation runs before the SDK call.

- [ ] **Step 1: Write the failing test**

Create `tests/stripe-intent.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeRes() {
  let statusCode, body;
  return {
    status(c) { statusCode = c; return this; },
    json(b) { body = b; return this; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
}

test('buildPaymentIntentParams shapes a full request', async () => {
  const { buildPaymentIntentParams } = await import('../api/stripe-intent.js');
  const params = buildPaymentIntentParams({
    amountCents: 199900,
    name: 'Acme Corp',
    email: 'ap@acme.com',
    invoice: 'ME-2026-0007',
    memo: 'Janitorial — April',
  });
  assert.equal(params.amount, 199900);
  assert.equal(params.currency, 'usd');
  assert.deepEqual(params.payment_method_types, ['card', 'us_bank_account']);
  assert.equal(params.receipt_email, 'ap@acme.com');
  assert.ok(params.description.includes('ME-2026-0007'));
  assert.ok(params.description.includes('Janitorial — April'));
  assert.equal(params.metadata.customer_name, 'Acme Corp');
  assert.equal(params.metadata.invoice, 'ME-2026-0007');
  assert.equal(params.metadata.memo, 'Janitorial — April');
});

test('buildPaymentIntentParams handles missing optional fields', async () => {
  const { buildPaymentIntentParams } = await import('../api/stripe-intent.js');
  const params = buildPaymentIntentParams({
    amountCents: 5000, name: '', email: 'x@y.com', invoice: '', memo: '',
  });
  assert.equal(params.description, 'Montissol Essentials');
  assert.equal(params.metadata.invoice, '');
});

test('buildPaymentIntentParams truncates an over-long description', async () => {
  const { buildPaymentIntentParams } = await import('../api/stripe-intent.js');
  const params = buildPaymentIntentParams({
    amountCents: 5000, name: 'N', email: 'x@y.com', invoice: '', memo: 'z'.repeat(2000),
  });
  assert.ok(params.description.length <= 1000);
});

test('handler rejects a non-POST method with 405', async () => {
  const { default: handler } = await import('../api/stripe-intent.js');
  const res = makeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
});

test('handler rejects an invalid amount with 400', async () => {
  const { default: handler } = await import('../api/stripe-intent.js');
  const res = makeRes();
  await handler({ method: 'POST', body: { amount: 0, email: 'x@y.com' } }, res);
  assert.equal(res.statusCode, 400);
});

test('handler rejects a bad email with 400', async () => {
  const { default: handler } = await import('../api/stripe-intent.js');
  const res = makeRes();
  await handler({ method: 'POST', body: { amount: 50, email: 'not-an-email' } }, res);
  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test`
Expected: `stripe-intent.test.js` fails — module not found.

- [ ] **Step 3: Implement the endpoint**

Create `api/stripe-intent.js`:

```js
import Stripe from 'stripe';
import { parseAmountToCents } from './_lib/amount.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildPaymentIntentParams({ amountCents, name, email, invoice, memo }) {
  const parts = ['Montissol Essentials'];
  if (invoice) parts.push(`Invoice ${invoice}`);
  if (memo) parts.push(memo);
  return {
    amount: amountCents,
    currency: 'usd',
    payment_method_types: ['card', 'us_bank_account'],
    receipt_email: email,
    description: parts.join(' – ').slice(0, 1000),
    metadata: {
      customer_name: name || '',
      invoice: invoice || '',
      memo: (memo || '').slice(0, 500),
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const body = req.body || {};

  let amountCents;
  try {
    amountCents = parseAmountToCents(body.amount);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const email = (body.email || '').trim();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const params = buildPaymentIntentParams({
      amountCents,
      name: (body.name || '').trim(),
      email,
      invoice: (body.invoice || '').trim(),
      memo: (body.memo || '').trim(),
    });
    const intent = await stripe.paymentIntents.create(params);
    res.status(200).json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error('stripe-intent failed:', err);
    res.status(502).json({ error: 'Could not start the payment. Please try again.' });
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: all 6 stripe-intent tests pass; all earlier tests still pass.

- [ ] **Step 5: Commit**

```bash
git add api/stripe-intent.js tests/stripe-intent.test.js
git commit -m "feat(payments): stripe payment-intent endpoint"
```

---

## Task 5: Remove PayPal from `invoice.html`

**Files:**
- Modify: `invoice.html`

- [ ] **Step 1: Remove the PayPal SDK script tag**

Delete this entire line (it is the only line matching `paypal.com/sdk`):

```html
  <script src="https://www.paypal.com/sdk/js?client-id=Adt-7jQG0-a9hOUWfxHJHDA_l06-NjckC_0ZPQ5N73iZ7CdvtDzZEOnWsVjAlZn-o1jvR8lzoepLZ3g_&currency=USD&intent=capture" defer></script>
```

- [ ] **Step 2: Remove the PayPal setup-instructions HTML comment**

Near the top of the file there is a large HTML comment block headed `PAYPAL SETUP INSTRUCTIONS`. Delete the entire `<!-- ... -->` comment block (it ends with the line `============================================================` followed by `-->`).

- [ ] **Step 3: Replace the PayPal button container**

Find:

```html
        <!-- PayPal Smart Payment Buttons -->
        <div id="paypal-button-container"></div>
```

Replace with:

```html
        <!-- Stripe Payment Element -->
        <div id="payment-element"></div>
        <button type="button" id="payBtn" class="btn primary" style="width:100%; margin-top:18px; padding:14px; font-size:1rem;">Pay</button>
```

- [ ] **Step 4: Remove the PayPal JavaScript block**

In the payment `<script>` IIFE, delete everything from the line `// ── PayPal Smart Buttons ──` through the end of the SDK-load listener — i.e. the `initPayPal` function declaration AND the `var sdkScript = ...` block that follows it. Stop before the IIFE's closing `})();`. The `})();` line itself stays. The amount-preview code and `validateForm()` above it stay untouched.

- [ ] **Step 5: Remove the PayPal CSS rule**

In the `<style>` block there is a CSS rule for `#paypal-button-container { … }`. Delete that entire rule (selector and braces). It is the only CSS rule referencing `paypal`.

- [ ] **Step 6: Update PayPal-branded copy**

Replace PayPal-specific wording with Stripe/processor-neutral wording:
- The two `<meta>` description tags mentioning "via PayPal or credit card" → "online by credit card or bank transfer".
- The hero subtitle "We accept PayPal and all major credit & debit cards — no PayPal account required." → "Pay securely by credit card or bank transfer (ACH)."
- The "Secured by PayPal" badge text → "Secured by Stripe".
- The "No PayPal Account Required" badge text → "Card & Bank Transfer".
- The success-screen line "A confirmation has been sent to your email by PayPal." → "A receipt has been emailed to you." (this line is also set dynamically in Task 6 — update the static HTML too).
- The `<div class="pay-notice">` block that begins "**No PayPal account needed.**" → replace its `<p>` content with: "Pay by credit/debit card or directly from your bank account (ACH). Card and bank details are entered securely and never touch our servers. Your payment goes to **Montissol Essentials LLC**."

- [ ] **Step 7: Verify no PayPal references remain**

Run: `node -e "const h=require('fs').readFileSync('invoice.html','utf8'); if(/paypal/i.test(h)) throw new Error('PayPal reference remains'); console.log('no PayPal references');"`
Expected: prints `no PayPal references`. If it throws, find the remaining reference and remove/reword it.

- [ ] **Step 8: Commit**

```bash
git add invoice.html
git commit -m "refactor(payments): remove PayPal from invoice page"
```

---

## Task 6: Add the Stripe Payment Element to `invoice.html`

**Files:**
- Modify: `invoice.html`

- [ ] **Step 1: Add the Stripe.js script tag**

Immediately before the line `<script src="assets/shared.js"></script>`, add:

```html
<script src="https://js.stripe.com/v3/"></script>
```

This loads synchronously before the inline payment script that uses the `Stripe` global, guaranteeing correct load order.

- [ ] **Step 2: Add the Stripe client flow**

Inside the payment `<script>` IIFE — in the place where the PayPal block was removed in Task 5, Step 4, and before the IIFE's closing `})();` — insert this code. It reuses the existing `amountInput` and `validateForm` defined earlier in the same IIFE:

```js
  // ── Stripe Payment Element ──
  var stripe, elements;
  var payBtn = document.getElementById('payBtn');
  var RETURN_URL = window.location.origin + window.location.pathname;

  function payError(msg) {
    var banner = document.getElementById('payFormError');
    banner.textContent = msg;
    banner.style.display = 'block';
  }

  function currentAmountCents() {
    var val = parseFloat(amountInput.value);
    return (!isNaN(val) && val >= 1) ? Math.round(val * 100) : 100;
  }

  function refreshPayButton() {
    var val = parseFloat(amountInput.value);
    payBtn.textContent = (!isNaN(val) && val >= 1)
      ? 'Pay $' + val.toFixed(2)
      : 'Pay';
  }
  amountInput.addEventListener('input', refreshPayButton);
  refreshPayButton();

  function showSuccess(pi) {
    document.getElementById('successTxId').textContent = pi.id;
    var invoice = document.getElementById('payInvoice').value.trim();
    if (invoice) {
      document.getElementById('successInvoice').textContent = invoice;
      document.getElementById('successInvoiceRow').style.display = 'block';
    }
    var titleEl = document.querySelector('#paySuccess .success-title');
    var subEl = document.querySelector('#paySuccess .success-sub');
    if (pi.status === 'processing') {
      titleEl.textContent = 'Bank Payment Submitted';
      subEl.textContent = 'Your bank payment is processing and will complete within 3–5 business days. A receipt has been emailed to you.';
    } else {
      titleEl.textContent = 'Payment Received!';
      subEl.textContent = 'Thank you for your payment to Montissol Essentials. A receipt has been emailed to you.';
    }
    document.getElementById('payFormWrap').style.display = 'none';
    document.getElementById('paySuccess').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function initStripe() {
    var cfg;
    try {
      cfg = await fetch('/api/stripe-config').then(function (r) { return r.json(); });
    } catch (e) { cfg = {}; }
    if (!cfg.publishableKey || typeof Stripe === 'undefined') {
      document.getElementById('payment-element').innerHTML =
        '<div style="padding:16px; border-radius:12px; background:rgba(239,68,68,.08); ' +
        'border:1px solid rgba(239,68,68,.2); color:#f87171; font-size:.85rem;">' +
        'The payment system could not be loaded. Please refresh, or contact us at ' +
        '<a href="mailto:Info@MontissolEssentials.com" style="color:var(--brand);">Info@MontissolEssentials.com</a>.</div>';
      payBtn.disabled = true;
      return;
    }
    stripe = Stripe(cfg.publishableKey);
    elements = stripe.elements({
      mode: 'payment',
      amount: currentAmountCents(),
      currency: 'usd',
      paymentMethodTypes: ['card', 'us_bank_account'],
    });
    elements.create('payment').mount('#payment-element');
  }

  amountInput.addEventListener('input', function () {
    if (elements) elements.update({ amount: currentAmountCents() });
  });

  payBtn.addEventListener('click', async function () {
    if (!stripe || !elements) return;
    if (!validateForm()) return;
    payBtn.disabled = true;
    document.getElementById('payFormError').style.display = 'none';

    var submitResult = await elements.submit();
    if (submitResult.error) {
      payError(submitResult.error.message);
      payBtn.disabled = false;
      return;
    }

    var clientSecret;
    try {
      var res = await fetch('/api/stripe-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(amountInput.value),
          name: document.getElementById('payName').value.trim(),
          email: document.getElementById('payEmail').value.trim(),
          invoice: document.getElementById('payInvoice').value.trim(),
          memo: document.getElementById('payMemo').value.trim(),
        }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start the payment.');
      clientSecret = data.clientSecret;
    } catch (err) {
      payError(err.message);
      payBtn.disabled = false;
      return;
    }

    var confirmResult = await stripe.confirmPayment({
      elements: elements,
      clientSecret: clientSecret,
      confirmParams: { return_url: RETURN_URL },
      redirect: 'if_required',
    });

    if (confirmResult.error) {
      payError(confirmResult.error.message);
      payBtn.disabled = false;
      return;
    }
    showSuccess(confirmResult.paymentIntent);
  });

  // Handle the return from a redirect-based payment method (e.g. ACH).
  async function handleRedirectReturn() {
    var cs = new URLSearchParams(window.location.search).get('payment_intent_client_secret');
    if (!cs || !stripe) return;
    var result = await stripe.retrievePaymentIntent(cs);
    if (result.paymentIntent) showSuccess(result.paymentIntent);
  }

  initStripe().then(handleRedirectReturn);
```

- [ ] **Step 3: Verify the file parses and references Stripe**

Run: `node -e "const h=require('fs').readFileSync('invoice.html','utf8'); if(!h.includes('js.stripe.com/v3')) throw new Error('Stripe.js missing'); if(!h.includes('payment-element')) throw new Error('Element missing'); console.log('stripe wired');"`
Expected: prints `stripe wired`.

- [ ] **Step 4: Commit**

```bash
git add invoice.html
git commit -m "feat(payments): add Stripe Payment Element to invoice page"
```

---

## Task 7: Stripe test-mode integration testing

**Files:** none (verification step). **Requires the user** — a Stripe account and test API keys.

- [ ] **Step 1: User creates a Stripe account**

The user signs up at stripe.com (no charge to create an account). In the Stripe Dashboard, ensure **Test mode** is on, and from Developers → API keys copy the **test** publishable key (`pk_test_…`) and **test** secret key (`sk_test_…`).

- [ ] **Step 2: User sets the test env vars in Vercel**

In the Vercel dashboard → project → Settings → Environment Variables, add for Production:
- `STRIPE_PUBLISHABLE_KEY` = the `pk_test_…` value
- `STRIPE_SECRET_KEY` = the `sk_test_…` value

- [ ] **Step 3: Deploy**

Merge `feat/stripe-payments` to `main` (or deploy the branch) so Vercel builds with the new env vars.

- [ ] **Step 4: Test a successful card payment**

On the live `invoice.html`, enter a name, email, amount, then in the Payment Element use test card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP. Confirm: the success screen shows "Payment Received!", and the payment appears in the Stripe test Dashboard.

- [ ] **Step 5: Test a declined card**

Repeat with card `4000 0000 0000 0002`. Confirm: an inline decline message appears and no success screen shows.

- [ ] **Step 6: Test an ACH payment**

Choose the US bank account option in the Payment Element and use Stripe's test bank (the Dashboard's test-mode docs list the current test bank credentials / test institution). Confirm: the success screen shows "Bank Payment Submitted" with the processing wording.

If any step fails, debug before going live.

---

## Task 8: Go live

**Files:** none. **Requires the user.**

- [ ] **Step 1: Activate the Stripe account**

The user completes Stripe's account activation (business details, bank account for payouts) so the account can accept live payments.

- [ ] **Step 2: Swap to live keys**

In Vercel, change `STRIPE_PUBLISHABLE_KEY` to the `pk_live_…` value and `STRIPE_SECRET_KEY` to the `sk_live_…` value. Redeploy.

- [ ] **Step 3: One real test transaction**

Make one small real card payment on the live site. Confirm it appears in the live Stripe Dashboard and that the payout is scheduled to the business bank account. Refund it from the Dashboard if desired.

- [ ] **Step 4: PCI SAQ-A**

Complete Stripe's PCI compliance self-assessment (SAQ-A) from the Dashboard when prompted — a short questionnaire, no audit.

---

## Self-Review Checklist (run after writing this plan)

- [x] **Spec coverage** — every spec section maps to a task:
  - `api/_lib/amount.js` → Task 2
  - `stripe-config.js` → Task 3
  - `stripe-intent.js` (+ `buildPaymentIntentParams`) → Task 4
  - `invoice.html` Payment Element + deferred-intent flow + success-status handling → Tasks 5, 6
  - Env vars, test-mode testing, go-live → Tasks 7, 8
  - PCI SAQ-A → Task 8
- [x] **No placeholders** — every code step contains complete code; no TBD/TODO
- [x] **Type consistency** — `parseAmountToCents` (Task 2) is consumed by `stripe-intent.js` (Task 4); `buildPaymentIntentParams` is defined and tested in Task 4; client field names (`amount`, `name`, `email`, `invoice`, `memo`) sent in Task 6 match what the Task 4 handler reads
- [x] **Frequent commits** — every implementation task ends with a commit
