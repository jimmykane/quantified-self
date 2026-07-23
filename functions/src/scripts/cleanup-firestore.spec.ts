import { describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

vi.mock('firebase-admin', () => ({
    apps: [{}],
    initializeApp: vi.fn(),
    firestore: vi.fn(() => ({})),
}));

vi.mock('../OAuth2', () => ({
    deauthorizeServiceForUser: vi.fn(),
}));

import { COLLECTION_GROUPS, DEAUTH_CONFIG } from './cleanup-firestore';

describe('cleanup-firestore provider coverage', () => {
    it('includes Wahoo token, queue, mapping, and remote deauthorization cleanup', () => {
        expect(COLLECTION_GROUPS).toEqual(expect.arrayContaining([
            'wahooAPIAccessTokens',
            'wahooAPIWorkoutQueue',
            'wahooAPIUserMappings',
        ]));
        expect(DEAUTH_CONFIG.wahooAPIAccessTokens).toMatchObject({
            service: ServiceNames.WahooAPI,
        });
    });
});
