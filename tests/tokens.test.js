import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../api/_lib/tokens.js';

const SECRET = 'test-secret-32-bytes-long-aaaaaa';

test('signToken + verifyToken round-trip', () => {
  const token = signToken('draft-123', 'approve', SECRET);
  const payload = verifyToken(token, SECRET);
  assert.deepEqual(payload, { draftId: 'draft-123', action: 'approve' });
});

test('verifyToken rejects forged signature', () => {
  const token = signToken('draft-123', 'approve', SECRET);
  const tampered = token.slice(0, -4) + 'AAAA';
  assert.equal(verifyToken(tampered, SECRET), null);
});

test('verifyToken rejects wrong secret', () => {
  const token = signToken('draft-123', 'approve', SECRET);
  assert.equal(verifyToken(token, 'different-secret-also-32-bytes-l'), null);
});

test('verifyToken rejects malformed token', () => {
  assert.equal(verifyToken('not-a-token', SECRET), null);
  assert.equal(verifyToken('', SECRET), null);
  assert.equal(verifyToken('a.b', SECRET), null);
});

test('signToken produces different tokens for different actions', () => {
  const a = signToken('draft-123', 'approve', SECRET);
  const r = signToken('draft-123', 'reject', SECRET);
  assert.notEqual(a, r);
});

test('verifyToken rejects tampered payload with original signature', () => {
  const token = signToken('draft-123', 'approve', SECRET);
  const [payload, sig] = token.split('.');
  const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  obj.action = 'reject';
  const badPayload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  assert.equal(verifyToken(`${badPayload}.${sig}`, SECRET), null);
});

test('verifyToken rejects non-string tokens', () => {
  assert.equal(verifyToken(null, SECRET), null);
  assert.equal(verifyToken(42, SECRET), null);
  assert.equal(verifyToken({}, SECRET), null);
});
