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
