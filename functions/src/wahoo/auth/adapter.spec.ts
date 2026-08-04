import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { WahooAuthAdapter } from './adapter';
import * as api from './api';

const firestoreMocks = vi.hoisted(() => {
  const query = { get: vi.fn() };
  const secondWhere = vi.fn(() => query);
  const firstWhere = vi.fn(() => ({ where: secondWhere }));
  const collectionGroup = vi.fn(() => ({ where: firstWhere }));
  return {
    query,
    secondWhere,
    firstWhere,
    collectionGroup,
  };
});

vi.mock('./api');
vi.mock('./auth', () => ({ WahooAPIAuth: vi.fn() }));
vi.mock('firebase-admin', () => ({
  firestore: () => ({ collectionGroup: firestoreMocks.collectionGroup }),
}));

describe('WahooAuthAdapter', () => {
  let adapter: WahooAuthAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new WahooAuthAdapter();
  });

  it('requests activity, route, and offline scopes needed for Wahoo imports and delivery', () => {
    expect(adapter.serviceName).toBe(ServiceNames.WahooAPI);
    expect(adapter.oAuthScopes).toBe('user_read workouts_read workouts_write routes_read routes_write offline_data');
  });

  it('resolves and stores the Wahoo user id', async () => {
    vi.mocked(api.getWahooUserID).mockResolvedValue('60462');
    const processed = await adapter.processNewToken({ token: { access_token: 'access' } } as any);
    const stored = adapter.convertTokenResponse({
      token: {
        access_token: 'access',
        refresh_token: 'refresh',
        token_type: 'bearer',
        expires_in: 7200,
      },
    } as any, processed.uniqueId);

    expect(api.getWahooUserID).toHaveBeenCalledWith('access');
    expect(stored.wahooUserID).toBe('60462');
    expect(stored.refreshToken).toBe('refresh');
    expect(stored.expiresAt).toBeGreaterThan(Date.now() + 7_000_000);
  });

  it('deauthorizes through the permissions endpoint helper', async () => {
    await adapter.deauthorize({ accessToken: 'access' } as any);
    expect(api.deauthorizeWahooUser).toHaveBeenCalledWith('access');
  });

  it('finds duplicate Wahoo connections through the shared token index', () => {
    expect(adapter.getDuplicateConnectionQuery('60462')).toBe(firestoreMocks.query);
    expect(firestoreMocks.collectionGroup).toHaveBeenCalledWith('tokens');
    expect(firestoreMocks.firstWhere).toHaveBeenCalledWith('wahooUserID', '==', '60462');
    expect(firestoreMocks.secondWhere).toHaveBeenCalledWith('serviceName', '==', ServiceNames.WahooAPI);
  });
});
