import OpenAI from 'openai';
import { put } from '@vercel/blob';

export async function generateImage({ prompt, draftId, openaiKey, blobToken }) {
  const client = new OpenAI({ apiKey: openaiKey });
  const resp = await client.images.generate({
    model: 'gpt-image-1',
    prompt,
    size: '1024x1024',
    n: 1,
  });
  const b64 = resp.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image data');
  const bytes = Buffer.from(b64, 'base64');
  const blob = await put(`fb-drafts/${draftId}.png`, bytes, {
    access: 'public',
    contentType: 'image/png',
    token: blobToken,
  });
  return blob.url;
}
