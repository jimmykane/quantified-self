import { describe, it, expect, vi } from 'vitest';
import { createSuuntoGuideClient, GUIDE_RESPONSE_BYTES } from './http';

describe('Suunto Guides HTTP isolation', () => {
  const auth = async () => ({ accessToken: 'fixture-token', account: 'fixture-user' });
  const key = () => 'fixture-subscription-key';
  it('uses the supplied subscription key, exact host and final guard with no redirects', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: null, payload: { username: 'fixture-user' } }), { status: 201 }));
    const guard = vi.fn();
    await createSuuntoGuideClient(auth, key, fetcher)({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, guard);
    expect(guard).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('https://cloudapi.suunto.com/v2/guides/files', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({
      Authorization: 'Bearer fixture-token', 'Ocp-Apim-Subscription-Key': 'fixture-subscription-key', 'Content-Type': 'application/zip',
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
  it('classifies a documented Guide validation response without exposing its private text', async () => {
    const privateText = 'Athlete private workout title';
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: {
      description: `Invalid step type: 'repeat' in ${privateText}` }, payload: null }), { status: 400 }));
    const client = createSuuntoGuideClient(auth, key, fetcher);
    try {
      await client({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn());
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ kind: 'terminal', rejected: true, message: 'terminal', diagnostics: {
        httpStatus: 400, failurePhase: 'response', providerRejection: 'invalid_parameter',
        providerField: 'guide_repeat', providerValidation: 'invalid_step_type', providerResponseShape: 'json',
      } });
      expect(JSON.stringify(error)).not.toContain(privateText);
    }
  });
  it.each([
    ['', { providerRejection: 'empty_response', providerResponseShape: 'empty' }],
    ['not json: private workout title', { providerRejection: 'unknown_validation', providerResponseShape: 'text' }],
    ['{"error":{"description":"Only fields steps are allowed in a repeat"}}',
      { providerRejection: 'unknown_validation', providerField: 'guide_field', providerValidation: 'invalid_child_step', providerResponseShape: 'json' }],
    ['{"error":{"description":"Invalid repeat steps"}}',
      { providerRejection: 'invalid_parameter', providerField: 'guide_repeat', providerValidation: 'invalid_repeat_structure', providerResponseShape: 'json' }],
    ['{"error":{"description":"Repeat times must be between 1 and 100"}}',
      { providerRejection: 'invalid_parameter', providerField: 'guide_repeat', providerValidation: 'invalid_repeat_count', providerResponseShape: 'json' }],
    ['x'.repeat(8 * 1024 + 1), { providerRejection: 'oversized_response', providerResponseShape: 'oversized' }],
  ])('keeps a bounded classification for a rejected Guide body', async (body, diagnostics) => {
    const client = createSuuntoGuideClient(auth, key, vi.fn(async () => new Response(body, { status: 400 })));
    await expect(client({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn()))
      .rejects.toMatchObject({ kind: 'terminal', rejected: true, diagnostics: { httpStatus: 400, failurePhase: 'response', ...diagnostics } });
  });
  it.each([404, 409])('does not equate %s with successful delivery/deletion', async status => {
    const client = createSuuntoGuideClient(auth, key, vi.fn(async () => new Response(null, { status })));
    expect(await client({ method: 'PUT', path: '/v2/guides/files/id', body: Buffer.from('zip') }, vi.fn())).toEqual({ status, body: null });
  });
  it.each(['invalid', 'missing'])('does not blame the user for an APIM %s subscription key', async reason => {
    const client = createSuuntoGuideClient(auth, key, vi.fn(async () => new Response(JSON.stringify({ statusCode: 401,
      message: `Access denied due to ${reason} subscription key. Private provider details must not be forwarded.` }), { status: 401 })));
    await expect(client({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn()))
      .rejects.toMatchObject({ kind: 'terminal', rejected: true, message: 'terminal', diagnostics: { httpStatus: 401, failurePhase: 'response' } });
  });
  it('recognizes an application-key challenge without depending on a JSON error body', async () => {
    const client = createSuuntoGuideClient(auth, key, vi.fn(async () => new Response('private', { status: 401,
      headers: { 'WWW-Authenticate': 'AzureApiManagementKey realm="private",name="Ocp-Apim-Subscription-Key",type="header"' } })));
    await expect(client({ method: 'GET', path: '/v2/guides/files/id' }, vi.fn()))
      .rejects.toMatchObject({ kind: 'terminal', rejected: true });
  });
  it.each(['{}', '{"statusCode":401,"message":"Invalid access token"}',
    '{"statusCode":400,"message":"Access denied due to invalid subscription key."}'])('keeps other 401 responses as OAuth failures: %s', async body => {
    const client = createSuuntoGuideClient(auth, key, vi.fn(async () => new Response(body, { status: 401 })));
    await expect(client({ method: 'GET', path: '/v2/guides/files/id' }, vi.fn())).rejects.toMatchObject({ kind: 'auth', rejected: true });
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
