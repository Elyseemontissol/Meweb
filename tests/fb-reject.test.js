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

test('fb-reject module loads and exports a default handler', async () => {
  const mod = await import('../api/fb-reject.js');
  assert.equal(typeof mod.default, 'function');
});

test('fb-reject rejects forged token', async () => {
  const { default: handler } = await import('../api/fb-reject.js');
  const res = makeRes();
  await handler({ query: { token: 'AAAA.BBBB' } }, res);
  assert.equal(res.statusCode, 401);
});

test('fb-reject of a dry-run draft does NOT advance the theme', async () => {
  const { signToken } = await import('../api/_lib/tokens.js');
  const redisMod = await import('../api/_lib/redis.js');

  let advanceCalls = 0;
  const draftId = 'dry-1';
  redisMod.redis.getdel = async (k) =>
    (k === `fb:draft:${draftId}`
      ? JSON.stringify({ theme: 'contracts', dry_run: true })
      : null);
  redisMod.redis.get = async () => null;
  redisMod.redis.set = async () => { advanceCalls++; return 'OK'; };
  redisMod.redis.lpush = async () => 1;
  redisMod.redis.ltrim = async () => 'OK';

  const token = signToken(draftId, 'reject', process.env.FB_APPROVAL_SECRET);
  const { default: handler } = await import('../api/fb-reject.js');
  const res = makeRes();
  await handler({ query: { token } }, res);

  assert.equal(res.statusCode, 200);
  // advanceTheme writes via redis.set; a dry-run reject must not call it.
  assert.equal(advanceCalls, 0);
});

test('fb-reject of a real draft advances the theme', async () => {
  const { signToken } = await import('../api/_lib/tokens.js');
  const redisMod = await import('../api/_lib/redis.js');

  let setCalls = 0;
  const draftId = 'real-1';
  redisMod.redis.getdel = async (k) =>
    (k === `fb:draft:${draftId}`
      ? JSON.stringify({ theme: 'contracts', dry_run: false })
      : null);
  redisMod.redis.get = async () => null;
  redisMod.redis.set = async () => { setCalls++; return 'OK'; };
  redisMod.redis.lpush = async () => 1;
  redisMod.redis.ltrim = async () => 'OK';

  const token = signToken(draftId, 'reject', process.env.FB_APPROVAL_SECRET);
  const { default: handler } = await import('../api/fb-reject.js');
  const res = makeRes();
  await handler({ query: { token } }, res);

  assert.equal(res.statusCode, 200);
  // advanceTheme writes the next theme via redis.set exactly once.
  assert.equal(setCalls, 1);
});
