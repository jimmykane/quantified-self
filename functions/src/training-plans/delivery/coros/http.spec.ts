import { describe, expect, it, vi } from 'vitest';
import { TrainingDeliveryTransportError } from '../contracts';
import { createCorosTrainingClient } from './http';

describe('COROS Training HTTP client', () => {
  it('uses the production form contract and never sends credentials in headers', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: '0000', message: 'OK', data: {} }), { status: 200 }));
    const beforeSend = vi.fn(async () => {});
    const client = createCorosTrainingClient(async () => ({ accessToken: 'token-secret', account: 'account-id' }), fetcher);
    await client({ path: '/coros/tp/list/push', data: '{"fixture":true}' }, beforeSend);
    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://open.coros.com/coros/tp/list/push', expect.objectContaining({
      method: 'POST', redirect: 'error', headers: {
        Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
      },
    }));
    const fields = new URLSearchParams(fetcher.mock.calls[0][1].body);
    expect(Object.fromEntries(fields.entries())).toEqual({ token: 'token-secret', openId: 'account-id', data: '{"fixture":true}' });
  });

  it.each([
    [401, 'auth'],
    [403, 'provider_access'],
    [429, 'deferred'],
    [500, 'uncertain'],
    [400, 'terminal'],
  ] as const)('classifies rejected HTTP %s as %s', async (status, kind) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status, headers: { 'Retry-After': '7' } }));
    const client = createCorosTrainingClient(async () => ({ accessToken: 'token', account: 'account' }), fetcher);
    await expect(client({ path: '/coros/tp/workout/deleteById', workoutIds: '[1]' }, async () => {}))
      .rejects.toMatchObject({ kind, rejected: status !== 500, ...(status === 429 ? { retryAfterMs: 7000 } : {}) });
  });

  it('keeps an HTTP timeout response uncertain after the request left QS', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 408 }));
    const client = createCorosTrainingClient(async () => ({ accessToken: 'token', account: 'account' }), fetcher);
    await expect(client({ path: '/coros/tp/list/push', data: '{}' }, async () => {}))
      .rejects.toMatchObject({ kind: 'uncertain', rejected: false });
  });

  it('keeps a lost response uncertain', async () => {
    const client = createCorosTrainingClient(async () => ({ accessToken: 'token', account: 'account' }),
      vi.fn().mockRejectedValue(new Error('network')));
    await expect(client({ path: '/coros/tp/workout/deleteById', workoutIds: '[1]' }, async () => {}))
      .rejects.toMatchObject({ kind: 'uncertain', rejected: false });
  });

  it('fails before HTTP for invalid request shapes', async () => {
    const fetcher = vi.fn();
    const client = createCorosTrainingClient(async () => ({ accessToken: 'token', account: 'account' }), fetcher);
    await expect(client({ path: '/coros/tp/list/push', workoutIds: '[1]' }, async () => {}))
      .rejects.toMatchObject({ kind: 'terminal', rejected: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('classifies authority failures as rejected before any provider request', async () => {
    const fetcher = vi.fn();
    const client = createCorosTrainingClient(async () => {
      throw new TrainingDeliveryTransportError('auth');
    }, fetcher);
    await expect(client({ path: '/coros/tp/list/push', data: '{}' }, async () => {}))
      .rejects.toMatchObject({ kind: 'auth', rejected: true, diagnostics: { failurePhase: 'request' } });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
