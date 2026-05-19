import { Redis } from '@upstash/redis';

export const redis = Redis.fromEnv();

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
