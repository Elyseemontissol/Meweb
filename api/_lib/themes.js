import { KEYS, THEMES } from './redis.js';

export async function getNextTheme(redis) {
  const stored = await redis.get(KEYS.nextTheme);
  if (THEMES.includes(stored)) return stored;
  return THEMES[0];
}

export async function advanceTheme(redis) {
  const current = await getNextTheme(redis);
  const idx = THEMES.indexOf(current);
  const next = THEMES[(idx + 1) % THEMES.length];
  await redis.set(KEYS.nextTheme, next);
  return next;
}
