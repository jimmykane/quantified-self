import { GoogleAuth } from 'google-auth-library';

export const FIRESTORE_DOCUMENTS_URL = 'https://firestore.googleapis.com/v1/projects/quantified-self-io/databases/(default)/documents';

/** Uses the existing GitHub WIF credential file, or explicitly configured local ADC. */
export async function createPublicSnapshotFetch({
  auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] }),
  fetchImpl = fetch,
} = {}) {
  let client;
  try {
    client = await auth.getClient();
  } catch {
    throw new Error('Public snapshots require Application Default Credentials with Firestore read access.');
  }

  return async (input, options = {}) => {
    const url = new URL(input);
    const resource = url.origin + url.pathname;
    const suffix = resource.startsWith(FIRESTORE_DOCUMENTS_URL) ? resource.slice(FIRESTORE_DOCUMENTS_URL.length) : '';
    const method = options.method ?? 'GET';
    if (!((suffix === ':runQuery' && method === 'POST')
      || (/^\/products(?:\/[^/]+\/prices)?$/.test(suffix) && method === 'GET'))) {
      throw new Error('Public snapshot request is outside the allowed Firestore resources.');
    }

    let headers;
    try {
      headers = new Headers(await client.getRequestHeaders(url.href));
      if (!headers.has('authorization')) throw new Error('Missing ADC authorization.');
    } catch {
      throw new Error('Could not authenticate public snapshots with Application Default Credentials.');
    }
    // Request options cannot replace the ADC Authorization header.
    for (const [key, value] of new Headers(options.headers)) {
      if (key !== 'authorization') headers.set(key, value);
    }
    try {
      return await fetchImpl(url, {
        ...options,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error('Public snapshot Firestore request failed or timed out.');
    }
  };
}
