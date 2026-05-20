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
