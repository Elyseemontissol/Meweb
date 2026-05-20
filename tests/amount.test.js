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
