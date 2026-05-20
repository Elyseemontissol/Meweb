const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

export async function checkPageToken({ pageId, accessToken }) {
  const url = `${GRAPH_BASE}/${pageId}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Page token health check failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function postToPage({ pageId, accessToken, message, imageUrl }) {
  const endpoint = imageUrl
    ? `${GRAPH_BASE}/${pageId}/photos`
    : `${GRAPH_BASE}/${pageId}/feed`;
  const params = new URLSearchParams();
  params.set('access_token', accessToken);
  params.set('message', message);
  if (imageUrl) params.set('url', imageUrl);
  const res = await fetch(endpoint, { method: 'POST', body: params });
  const json = await res.json();
  if (!res.ok || json.error) {
    const msg = json.error?.message || JSON.stringify(json);
    throw new Error(`Graph API error (${res.status}): ${msg}`);
  }
  return json;
}

export function buildFbPostUrl(pageId, postOrPhotoId) {
  return `https://www.facebook.com/${pageId}/posts/${postOrPhotoId}`;
}
