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
  it.each([200, 201])('decodes POST %s without substituting a different success status', async status => {
    const payload = { id: 'guide', username: 'fixture-user' };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: null, payload }), { status }));
    expect(await createSuuntoGuideClient(auth, key, fetcher)({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn()))
      .toEqual({ status, body: payload });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('retains uncertainty and private-safe validation labels for a POST 200 application error', async () => {
    const privateText = 'Private athlete title';
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: {
      description: `Invalid step type in ${privateText}` }, payload: null }), { status: 200 }));
    let caught: unknown;
    try { await createSuuntoGuideClient(auth, key, fetcher)({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn()); }
    catch (error) { caught = error; }
    expect(caught).toMatchObject({ kind: 'uncertain', rejected: false, diagnostics: {
      httpStatus: 200, failurePhase: 'decode', providerRejection: 'invalid_parameter',
      providerField: 'guide_step', providerValidation: 'invalid_step_type', providerResponseShape: 'json',
    } });
    expect(JSON.stringify(caught)).not.toContain(privateText);
  });
  it.each([[401, 'auth'], [403, 'permission'], [429, 'deferred'], [500, 'uncertain'], [202, 'uncertain']])('handles POST %s without private diagnostics', async (status, kind) => {
    const fetcher = vi.fn(async () => new Response('private', { status: Number(status), headers: { 'Retry-After': '120' } }));
    const promise = createSuuntoGuideClient(auth, key, fetcher)({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn());
    await expect(promise).rejects.toMatchObject({ kind, ...(status === 429 ? { rejected: true, retryAfterMs: 120_000 } : {}) });
    expect(fetcher).toHaveBeenCalledTimes(status === 401 || status === 403 ? 2 : 1);
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
    ['{"error":{"description":"Invalid \'guide.steps.0.id\': Step id not allowed inside repeat"}}',
      { providerRejection: 'invalid_parameter', providerField: 'guide_repeat', providerValidation: 'forbidden_repeat_step_id', providerResponseShape: 'json' }],
    ['{"error":{"description":"Invalid \'guide.steps.0.steps.0.id\': Step id not allowed inside repeat"}}',
      { providerRejection: 'invalid_parameter', providerField: 'guide_repeat', providerValidation: 'forbidden_repeat_step_id', providerResponseShape: 'json' }],
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
  it.each([401, 403].flatMap(status => ['invalid', 'missing'].map(reason => ({ status, reason }))))('does not refresh an APIM $status $reason subscription key', async ({ status, reason }) => {
    const authorize = vi.fn(auth);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ statusCode: status,
      message: `Access denied due to ${reason} subscription key. Private provider details must not be forwarded.` }), { status }));
    const client = createSuuntoGuideClient(authorize, key, fetcher);
    await expect(client({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn()))
      .rejects.toMatchObject({ kind: 'terminal', rejected: true, message: 'terminal', diagnostics: { httpStatus: status, failurePhase: 'response' } });
    expect(authorize.mock.calls).toEqual([[false]]);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([401, 403])('recognizes an HTTP %s application-key challenge without depending on a JSON error body', async status => {
    const authorize = vi.fn(auth);
    const fetcher = vi.fn(async () => new Response('private', { status,
      headers: { 'WWW-Authenticate': 'AzureApiManagementKey realm="private",name="Ocp-Apim-Subscription-Key",type="header"' } }));
    const client = createSuuntoGuideClient(authorize, key, fetcher);
    await expect(client({ method: 'GET', path: '/v2/guides/files/id' }, vi.fn()))
      .rejects.toMatchObject({ kind: 'terminal', rejected: true });
    expect(authorize.mock.calls).toEqual([[false]]);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([401, 403])('refreshes HTTP %s once, repeating only the rejected request after journaling it', async status => {
    const authorize = vi.fn().mockResolvedValueOnce({ accessToken: 'old', account: 'fixture-user' })
      .mockResolvedValueOnce({ accessToken: 'new', account: 'fixture-user' });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: null, payload: { username: 'fixture-user' } }), { status: 201 }));
    const rejected = vi.fn(); const guard = vi.fn();
    await createSuuntoGuideClient(authorize, key, fetcher)({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, guard, rejected);
    expect(authorize.mock.calls).toEqual([[false], [true]]);
    expect(rejected).toHaveBeenCalledOnce();
    expect(rejected.mock.invocationCallOrder[0]).toBeLessThan(authorize.mock.invocationCallOrder[1]);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://cloudapi.suunto.com/v2/guides/files', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer new' }), body: new Uint8Array(Buffer.from('zip')),
    }));
  });
  it('does not replay an OAuth rejection if refresh changes account or fails', async () => {
    for (const fail of [false, true]) {
      const authorize = vi.fn().mockResolvedValueOnce({ accessToken: 'old', account: 'fixture-user' }).mockImplementationOnce(async () => {
        if (fail) throw new Error('refresh');
        return { accessToken: 'new', account: 'other' };
      });
      const fetcher = vi.fn(async () => new Response(null, { status: 403 }));
      await expect(createSuuntoGuideClient(authorize, key, fetcher)({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn()))
        .rejects.toMatchObject({ rejected: true });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it.each(['GET', 'PUT', 'DELETE'] as const)('also recovers a rejected %s without changing its method or path', async method => {
    const authorize = vi.fn(auth);
    const request = { method, path: '/v2/guides/files/id', ...(method === 'PUT' ? { body: Buffer.from('zip') } : {}) };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(
      new Response(method === 'GET' ? 'zip' : method === 'PUT' ? JSON.stringify({ error: null, payload: { username: 'fixture-user' } }) : null, { status: 200 }));
    await expect(createSuuntoGuideClient(authorize, key, fetcher)(request, vi.fn())).resolves.toMatchObject({ status: 200 });
    expect(authorize.mock.calls).toEqual([[false], [true]]);
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://cloudapi.suunto.com/v2/guides/files/id', expect.objectContaining({ method }));
  });
  it('does not refresh or resend if the rejection checkpoint fails', async () => {
    const authorize = vi.fn(auth);
    const fetcher = vi.fn(async () => new Response(null, { status: 403 }));
    await expect(createSuuntoGuideClient(authorize, key, fetcher)(
      { method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn(), async () => { throw new Error('checkpoint'); },
    )).rejects.toThrow('checkpoint');
    expect(authorize.mock.calls).toEqual([[false]]);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('keeps the second write uncertain after a transport failure rather than reusing the first rejection', async () => {
    const authorize = vi.fn(auth);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 })).mockRejectedValueOnce(new Error('timeout'));
    await expect(createSuuntoGuideClient(authorize, key, fetcher)(
      { method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn(), vi.fn(),
    )).rejects.toMatchObject({ kind: 'uncertain', rejected: false });
    expect(authorize.mock.calls).toEqual([[false], [true]]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rechecks the guard after refresh and does not repeat an accepted request after a decoding failure', async () => {
    const authorize = vi.fn(auth);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response('malformed', { status: 201 }));
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('stopped'));
    const request = { method: 'POST' as const, path: '/v2/guides/files', body: Buffer.from('zip') };
    await expect(createSuuntoGuideClient(authorize, key, fetcher)(request, guard)).rejects.toThrow('stopped');
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockReset().mockResolvedValue(new Response('malformed', { status: 201 }));
    authorize.mockClear();
    await expect(createSuuntoGuideClient(authorize, key, fetcher)(request, vi.fn())).rejects.toMatchObject({ kind: 'uncertain', rejected: false });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledOnce();
  });
  it.each(['{}', '{"statusCode":401,"message":"Invalid access token"}',
    '{"statusCode":400,"message":"Access denied due to invalid subscription key."}'])('keeps other 401 responses as OAuth failures: %s', async body => {
    const client = createSuuntoGuideClient(auth, key, vi.fn(async () => new Response(body, { status: 401 })));
    await expect(client({ method: 'GET', path: '/v2/guides/files/id' }, vi.fn())).rejects.toMatchObject({ kind: 'auth', rejected: true });
  });
  it.each([200, 201].flatMap(status => ['', 'null', '{}', '{"error":null,"payload":{"username":"other"}}', 'x'.repeat(GUIDE_RESPONSE_BYTES + 1)]
    .map(body => ({ status, body }))))('rejects empty, malformed, wrong-account or oversized POST $status envelopes', async ({ status, body }) => {
    const client = createSuuntoGuideClient(auth, key, vi.fn(async () => new Response(body, { status })));
    await expect(client({ method: 'POST', path: '/v2/guides/files', body: Buffer.from('zip') }, vi.fn())).rejects.toMatchObject({ kind: 'uncertain' });
  });
  it.each(['https://evil.test', '/v2/guides/files/../id', '/v2/guides/items?fileSince=1', '/v2/workouts'])('rejects foreign paths before credentials: %s', async path => {
    const authorize = vi.fn();
    await expect(createSuuntoGuideClient(authorize, key)({ method: 'GET', path }, vi.fn())).rejects.toMatchObject({ kind: 'terminal' });
    expect(authorize).not.toHaveBeenCalled();
  });
});
