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
