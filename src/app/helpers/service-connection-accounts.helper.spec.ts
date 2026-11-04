import { describe, expect, it } from 'vitest';
import { serviceConnectionAccountsFromMeta } from '@shared/service-connection';

describe('safe service connection accounts', () => {
  it('keeps accounts and permission state from the supplied snapshot', () => {
    const accounts = [{ providerUserId: 'provider-account', permissions: ['ACTIVITY_EXPORT'] }];
    expect(serviceConnectionAccountsFromMeta({ connectionAccounts: accounts })).toEqual(accounts);
  });

  it('does not invent projected accounts from connected state or a pinned identity', () => {
    expect(serviceConnectionAccountsFromMeta({ connectionState: 'connected', providerUserId: 'pinned' })).toEqual([]);
    expect(serviceConnectionAccountsFromMeta({ connectionAccounts: [] })).toEqual([]);
    expect(serviceConnectionAccountsFromMeta(undefined)).toEqual([]);
  });

  it('preserves retained accounts while a disconnect is pending', () => {
    expect(serviceConnectionAccountsFromMeta({ connectionState: 'disconnect_pending',
      connectionAccounts: [{ providerUserId: 'retained' }] })).toEqual([{ providerUserId: 'retained' }]);
  });

  it('allows the state-only Wahoo fallback only when explicitly requested and connected', () => {
    expect(serviceConnectionAccountsFromMeta({ connectionState: 'connected', providerUserId: 'wahoo' }, true))
      .toEqual([{ providerUserId: 'wahoo' }]);
    expect(serviceConnectionAccountsFromMeta({ connectionState: 'connected' }, true)).toEqual([{}]);
    expect(serviceConnectionAccountsFromMeta({ connectionState: 'disconnect_pending', providerUserId: 'wahoo' }, true))
      .toEqual([]);
    expect(serviceConnectionAccountsFromMeta({ connectionState: 'reconnect_required', providerUserId: 'wahoo' }, true))
      .toEqual([]);
  });
});
