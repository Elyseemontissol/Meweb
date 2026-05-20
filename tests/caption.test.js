import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptionResponse } from '../api/_lib/caption.js';

test('parses clean JSON', () => {
  const raw = '{"caption":"Hello","image_prompt":"A truck","hashtags":["#a","#b"]}';
  const out = parseCaptionResponse(raw);
  assert.deepEqual(out, { caption: 'Hello', image_prompt: 'A truck', hashtags: ['#a', '#b'] });
});

test('strips ```json fences', () => {
  const raw = '```json\n{"caption":"Hi","image_prompt":"x","hashtags":[]}\n```';
  const out = parseCaptionResponse(raw);
  assert.equal(out.caption, 'Hi');
});

test('strips plain ``` fences', () => {
  const raw = '```\n{"caption":"Hi","image_prompt":"x","hashtags":[]}\n```';
  assert.equal(parseCaptionResponse(raw).caption, 'Hi');
});

test('throws on missing required fields', () => {
  assert.throws(() => parseCaptionResponse('{"caption":"only"}'));
  assert.throws(() => parseCaptionResponse('{"image_prompt":"only"}'));
});

test('throws on invalid JSON', () => {
  assert.throws(() => parseCaptionResponse('not json at all'));
});

test('coerces missing hashtags to empty array', () => {
  const raw = '{"caption":"Hi","image_prompt":"x"}';
  assert.deepEqual(parseCaptionResponse(raw).hashtags, []);
});
