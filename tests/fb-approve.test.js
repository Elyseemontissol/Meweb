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
