import { describe, expect, it, vi } from 'vitest';
import { createGarminTrainingClient, garminBody, garminId, parseGarminTrainingJSON, GARMIN_TRAINING_RESPONSE_BYTES } from './http';

describe('Garmin Training HTTP boundary (no network)', () => {
  it('preserves Long IDs and emits exact numeric identity fields without altering text', () => {
    const raw = '{"workoutId":9223372036854775807,"ownerId":123,"description":'
      + JSON.stringify('9223372036854775807 and "workoutId":123') + '}';
    const parsed = parseGarminTrainingJSON(raw) as Record<string, unknown>;
    expect(parsed.workoutId).toBe('9223372036854775807');
    expect(parsed.ownerId).toBe(123);
    expect(parsed.description).toBe('9223372036854775807 and "workoutId":123');
    expect(garminBody({ date: '2027-01-01' }, { workoutId: garminId(parsed.workoutId) }))
      .toBe('{"date":"2027-01-01","workoutId":9223372036854775807}');
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '', '01', '1e3', '1.0', '9223372036854775808', '../12', {}])('rejects invalid identity %j', id => {
    expect(() => garminId(id)).toThrow();
  });
  it('authorizes and journals before one bounded, nonredirecting request', async () => {
    const order: string[] = [];
    const fetcher = vi.fn(async () => { order.push('http'); return new Response('{}'); });
    const client = createGarminTrainingClient(async () => { order.push('auth'); return 'fixture-secret'; }, fetcher);
    await client({ method: 'POST', path: '/workoutportal/workout/v2', body: '{}' }, async () => { order.push('journal'); });
    expect(order).toEqual(['auth', 'journal', 'http']);
    expect(fetcher).toHaveBeenCalledWith('https://apis.garmin.com/workoutportal/workout/v2', expect.objectContaining({
      redirect: 'error', signal: expect.any(AbortSignal), method: 'POST', body: '{}',
    }));
  });
  it.each(['/training-api/workout/v2/1?token=x', 'https://evil.test', '/training-api/schedule/../1'])('rejects an unapproved path before auth: %s', async path => {
    const auth = vi.fn(); const fetcher = vi.fn();
    await expect(createGarminTrainingClient(auth, fetcher)({ method: 'GET', path }, vi.fn())).rejects.toMatchObject({ kind: 'terminal' });
    expect(auth).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not send when a final lifecycle/journal guard fails', async () => {
    const fetcher = vi.fn();
    await expect(createGarminTrainingClient(async () => 'fixture', fetcher)({ method: 'DELETE', path: '/training-api/schedule/1' },
      async () => { throw new Error('local guard'); })).rejects.toThrow('local guard');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[401, 'auth', true], [403, 'permission', true], [412, 'permission', true], [400, 'terminal', true],
    [429, 'retryable', true], [500, 'uncertain', false], [408, 'uncertain', false]])('classifies POST %s without retaining payloads', async (status, kind, rejected) => {
    const fetcher = vi.fn(async () => new Response('private-token-provider-body', { status: Number(status), headers: { 'Retry-After': '120' } }));
    const client = createGarminTrainingClient(async () => 'fixture', fetcher);
    let failure: unknown;
    try { await client({ method: 'POST', path: '/workoutportal/workout/v2' }, vi.fn()); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ kind, rejected, diagnostics: { httpStatus: status, failurePhase: 'response' } });
    expect(JSON.stringify(failure)).not.toContain('private-token');
    if (status === 429) expect(failure).toMatchObject({ retryAfterMs: 120_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('honors dated Retry-After and backs off a day when the exceeded quota is unknown', async () => {
    const now = Date.parse('2026-09-14T10:00:00Z');
    for (const retry of ['Mon, 14 Sep 2026 10:02:00 GMT', 'invalid']) {
      const client = createGarminTrainingClient(async () => 'fixture', vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': retry } })), () => now);
      await expect(client({ method: 'GET', path: '/training-api/workout/v2/1' }, vi.fn()))
        .rejects.toMatchObject({ retryAfterMs: retry === 'invalid' ? 86_400_000 : 120_000 });
    }
  });
  it('does not shorten a provider retry delay longer than a day or repair malformed JSON', async () => {
    const client = createGarminTrainingClient(async () => 'fixture', vi.fn(async () =>
      new Response('', { status: 429, headers: { 'Retry-After': '172800' } })));
    await expect(client({ method: 'GET', path: '/training-api/workout/v2/1' }, vi.fn()))
      .rejects.toMatchObject({ retryAfterMs: 172_800_000 });
    expect(() => parseGarminTrainingJSON('{"workoutId":01234567890123456}')).toThrow();
  });
  it.each(['GET', 'POST'] as const)('bounds malformed, oversized and failed %s responses', async method => {
    for (const result of ['not-json', 'x'.repeat(GARMIN_TRAINING_RESPONSE_BYTES + 1), null]) {
      const fetcher = vi.fn(async () => { if (result === null) throw new Error('private-network-error'); return new Response(result); });
      await expect(createGarminTrainingClient(async () => 'fixture', fetcher)({ method,
        path: method === 'GET' ? '/training-api/workout/v2/1' : '/workoutportal/workout/v2' }, vi.fn()))
        .rejects.toMatchObject({ kind: method === 'GET' ? 'retryable' : 'uncertain', rejected: false });
    }
  });
  it.each(['', '   ', 'null'])('rejects an empty successful lookup (%j) instead of treating it as absence', async body => {
    const client = createGarminTrainingClient(async () => 'fixture', vi.fn(async () => new Response(body)));
    await expect(client({ method: 'GET', path: '/training-api/workout/v2/1' }, vi.fn()))
      .rejects.toMatchObject({ kind: 'retryable', rejected: false });
  });
  it.each([
    ['GET', 204, 'retryable'], ['GET', 206, 'retryable'],
    ['POST', 202, 'uncertain'], ['PUT', 202, 'uncertain'], ['DELETE', 202, 'uncertain'],
  ] as const)('does not mistake %s %s for confirmed completion', async (method, status, kind) => {
    const client = createGarminTrainingClient(async () => 'fixture', vi.fn(async () => new Response(null, { status })));
    await expect(client({ method, path: method === 'POST' ? '/workoutportal/workout/v2' : '/training-api/workout/v2/1' }, vi.fn()))
      .rejects.toMatchObject({ kind, rejected: false });
  });
  it.each(['GET', 'DELETE'] as const)('preserves explicit %s 404 absence', async method => {
    const client = createGarminTrainingClient(async () => 'fixture', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(client({ method, path: '/training-api/workout/v2/1' }, vi.fn())).resolves.toEqual({ status: 404, body: null });
  });
  it('passes documented POST 204 to the adapter for identity inspection, without claiming an artifact', async () => {
    const client = createGarminTrainingClient(async () => 'fixture', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(client({ method: 'POST', path: '/training-api/schedule/', body: '{}' }, vi.fn()))
      .resolves.toEqual({ status: 204, body: null });
  });
  it('distinguishes a lost request from response decoding without exposing private error text', async () => {
    for (const received of [false, true]) {
      const client = createGarminTrainingClient(async () => 'fixture', vi.fn(async () => {
        if (!received) throw new Error('private-network-detail');
        return new Response('private-malformed-body');
      }));
      let failure: unknown;
      try { await client({ method: 'POST', path: '/training-api/schedule/' }, vi.fn()); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ diagnostics: received ? { httpStatus: 200, failurePhase: 'decode' } : { failurePhase: 'request' } });
      expect(JSON.stringify(failure)).not.toContain('private');
    }
  });
});
