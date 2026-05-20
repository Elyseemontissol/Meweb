import { Redis } from '@upstash/redis';

const _client = Redis.fromEnv();

// Export a plain mutable object so tests can patch individual methods.
export const redis = {
  get:      (...args) => _client.get(...args),
  set:      (...args) => _client.set(...args),
  del:      (...args) => _client.del(...args),
  getdel:   (...args) => _client.getdel(...args),
  lrange:   (...args) => _client.lrange(...args),
  lpush:    (...args) => _client.lpush(...args),
  ltrim:    (...args) => _client.ltrim(...args),
  smembers: (...args) => _client.smembers(...args),
  sadd:     (...args) => _client.sadd(...args),
  srem:     (...args) => _client.srem(...args),
};

export const KEYS = {
  draft: (id) => `fb:draft:${id}`,
  nextTheme: 'fb:next_theme',
  history: 'fb:history',
  recruitingNextRole: 'fb:recruiting_next_role',
};

export const THEMES = ['contracts', 'recruiting', 'community'];
export const JOB_ROLES = [
  'janitorial-tech',
  'industrial-cleaning',
  'maintenance-tech',
  'qc-compliance',
  'qc-inspector',
  'site-supervisor',
];
