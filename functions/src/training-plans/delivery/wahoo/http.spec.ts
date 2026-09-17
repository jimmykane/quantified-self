import { describe, expect, it, vi } from 'vitest';
import { TrainingDeliveryTransportError } from '../contracts';
import { createWahooTrainingClient, WAHOO_TRAINING_RESPONSE_BYTES, wahooId } from './http';

describe('Wahoo Training HTTP boundary', () => {
  const authority = () => ({ accessToken: 'fixture-token', account: '123', assertCurrent: vi.fn(async () => {}) });
  const post = { method: 'POST' as const, path: '/v1/plans', body: 'plan[file]=fixture' };
  it('uses exactly one guarded form request to the fixed API host', async () => {
    const events: string[] = [];
    const fetcher = vi.fn(async () => { events.push('fetch'); return new Response('{"id":9007199254740993,"user_id":123}', { status: 201 }); });
    const client = createWahooTrainingClient(async () => ({ ...authority(), assertCurrent: async () => { events.push('credential'); } }), fetcher,
      Date.now, { reserve: async () => { events.push('quota'); }, defer: vi.fn() });
    const response = await client(post, async () => { events.push('journal'); });
    expect(response.body).toEqual({ id: '9007199254740993', user_id: 123 });
    expect(events).toEqual(['quota', 'credential', 'journal', 'fetch']);
    expect(fetcher).toHaveBeenCalledWith('https://api.wahooligan.com/v1/plans', expect.objectContaining({
      redirect: 'error', headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }), body: post.body,
    }));
  });
  it.each([['https://evil.example', 'GET'], ['/v1/plans/1?url=evil', 'GET'], ['/v1/plans', 'DELETE'], ['/v1/workouts/1/plans', 'PUT']])(
    'rejects unsupported path/method %s %s before authorization', async (path, method) => {
      const authorize = vi.fn(async () => authority()); const fetcher = vi.fn();
      await expect(createWahooTrainingClient(authorize, fetcher)({ path, method: method as 'GET' }, vi.fn())).rejects.toMatchObject({ kind: 'terminal', rejected: true });
      expect(authorize).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    });
  it.each([[401, 'auth', true], [403, 'provider_access', true], [422, 'terminal', true], [500, 'uncertain', false], [408, 'uncertain', false], [202, 'uncertain', false]])(
    'classifies %s without leaking provider content', async (status, kind, rejected) => {
      const fetcher = vi.fn(async () => new Response('private-response', { status: status as number }));
      await expect(createWahooTrainingClient(async () => authority(), fetcher)(post, vi.fn()))
        .rejects.toMatchObject({ kind, rejected, message: kind, diagnostics: { httpStatus: status } });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  it('retains the largest server delay and shares it even when a request was rejected', async () => {
    const capacity = { reserve: vi.fn(), defer: vi.fn() };
    const fetcher = vi.fn(async () => new Response('private', { status: 429,
      headers: { 'retry-after': '90', 'x-ratelimit-reset': '300', 'x-ratelimit-remaining': '4800,800,0' } }));
    await expect(createWahooTrainingClient(async () => authority(), fetcher, () => 1000, capacity)(post, vi.fn()))
      .rejects.toMatchObject({ kind: 'deferred', rejected: true, retryAfterMs: 300000 });
    expect(capacity.defer).toHaveBeenCalledWith(301000);
  });
  it('keeps pre-request credential failure definitely unaccepted', async () => {
    const fetcher = vi.fn();
    const client = createWahooTrainingClient(async () => ({ ...authority(), assertCurrent: async () => { throw new TrainingDeliveryTransportError('retryable'); } }), fetcher);
    await expect(client(post, vi.fn())).rejects.toMatchObject({ kind: 'retryable', rejected: true });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[401, 'auth'], [403, 'provider_access'], [422, 'terminal'], [429, 'deferred']])(
    'retains a known %s rejection when response cleanup fails', async (status, kind) => {
      const response = new Response(new ReadableStream({ cancel: () => { throw new Error('cleanup'); } }), { status: Number(status) });
      const client = createWahooTrainingClient(async () => authority(), vi.fn(async () => response));
      await expect(client(post, vi.fn())).rejects.toMatchObject({ kind, rejected: true, diagnostics: { httpStatus: status } });
    });
  it.each([200, 404])('retains a DELETE %s outcome when response cleanup fails', async status => {
    const response = new Response(new ReadableStream({ cancel: () => { throw new Error('cleanup'); } }), { status });
    const client = createWahooTrainingClient(async () => authority(), vi.fn(async () => response));
    await expect(client({ method: 'DELETE', path: '/v1/workouts/1' }, vi.fn())).resolves.toEqual({ status, body: null });
  });
  it.each(['{"id":1,"user_id":456}', 'not-json', 'x'.repeat(WAHOO_TRAINING_RESPONSE_BYTES + 1)])('bounds and validates responses', async body => {
    const client = createWahooTrainingClient(async () => authority(), vi.fn(async () => new Response(body, { status: 201 })));
    await expect(client(post, vi.fn())).rejects.toMatchObject({ kind: 'uncertain', rejected: false });
  });
  it('does not mistake empty reads or a dropped connection for authoritative absence', async () => {
    const client = createWahooTrainingClient(async () => authority(), vi.fn(async () => new Response('', { status: 200 })));
    await expect(client({ method: 'GET', path: '/v1/plans/1' }, vi.fn())).rejects.toMatchObject({ kind: 'retryable' });
    const dropped = createWahooTrainingClient(async () => authority(), vi.fn(async () => { throw new Error('private-token'); }));
    await expect(dropped(post, vi.fn())).rejects.toMatchObject({ kind: 'uncertain', message: 'uncertain' });
    expect(() => wahooId(9007199254740992)).toThrow();
  });
});
