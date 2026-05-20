import { test } from 'node:test';
import assert from 'node:assert/strict';

// Required envs so the module's top-level Redis init doesn't throw.
process.env.UPSTASH_REDIS_REST_URL = 'http://localhost';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test';

test('fb-draft module loads and exports a default handler', async () => {
  const mod = await import('../api/fb-draft.js');
  assert.equal(typeof mod.default, 'function');
});
