import { describe, it, expect, vi } from 'vitest';
import { createSuuntoGuideClient, GUIDE_RESPONSE_BYTES } from './http';

describe('Suunto Guides HTTP isolation', () => {
  const auth = async () => ({ accessToken: 'fixture-token', account: 'fixture-user' });
  const key = () => 'fixture-guides-key';
  it('uses the Guides key, exact host and final guard with no redirects', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: null, payload: { username: 'fixture-user' } }), { status: 201 }));
    const guard = vi.fn();
    await createSuuntoGuideClient(auth, key, fetcher)({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, guard);
    expect(guard).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('https://cloudapi.suunto.com/v2/guides/files', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({
      Authorization: 'Bearer fixture-token', 'Ocp-Apim-Subscription-Key': 'fixture-guides-key', 'Content-Type': 'application/zip',
    }) }));
  });
  it('does not fall back to other credentials or send when the guard fails', async () => {
    const fetcher = vi.fn();
    await expect(createSuuntoGuideClient(auth, () => '', fetcher)({ method: 'GET', path: '/v2/guides/files/id' }, vi.fn())).rejects.toMatchObject({ kind: 'terminal', rejected: true });
    await expect(createSuuntoGuideClient(auth, key, fetcher)({ method: 'GET', path: '/v2/guides/files/id' }, async () => { throw new Error('stale'); })).rejects.toThrow('stale');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[401, 'auth'], [403, 'permission'], [429, 'deferred'], [500, 'uncertain'], [202, 'uncertain']])('handles POST %s without private diagnostics', async (status, kind) => {
    const fetcher = vi.fn(async () => new Response('private', { status: Number(status), headers: { 'Retry-After': '120' } }));
    const promise = createSuuntoGuideClient(auth, key, fetcher)({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn());
    await expect(promise).rejects.toMatchObject({ kind, ...(status === 429 ? { rejected: true, retryAfterMs: 120_000 } : {}) });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([404, 409])('does not equate %s with successful delivery/deletion', async status => {
    const client = createSuuntoGuideClient(auth, key, vi.fn(async () => new Response(null, { status })));
    expect(await client({ method: 'PUT', path: '/v2/guides/files/id', body: Buffer.from('zip') }, vi.fn())).toEqual({ status, body: null });
  });
  it.each(['', 'null', '{}', '{"error":null,"payload":{"username":"other"}}', 'x'.repeat(GUIDE_RESPONSE_BYTES + 1)])('rejects empty, malformed, wrong-account or oversized envelopes', async body => {
    const client = createSuuntoGuideClient(auth, key, vi.fn(async () => new Response(body, { status: 201 })));
    await expect(client({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn())).rejects.toMatchObject({ kind: 'uncertain' });
  });
  it.each(['https://evil.test', '/v2/guides/files/../id', '/v2/guides/items?fileSince=1', '/v2/workouts'])('rejects foreign paths before credentials: %s', async path => {
    const authorize = vi.fn();
    await expect(createSuuntoGuideClient(authorize, key)({ method: 'GET', path }, vi.fn())).rejects.toMatchObject({ kind: 'terminal' });
    expect(authorize).not.toHaveBeenCalled();
  });
});
