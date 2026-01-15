
import { deauthorizeSuuntoUser } from './api';
import * as requestPromise from '../../request-helper';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '../../config';

vi.mock('../../request-helper');
vi.mock('firebase-functions/logger');

describe('Suunto Auth API', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('deauthorizeSuuntoUser', () => {
        it('should call Suunto deauthorize endpoint', async () => {
            await deauthorizeSuuntoUser('access-token');

            expect(requestPromise.get).toHaveBeenCalledWith({
                headers: {
                    'Authorization': 'Bearer access-token',
                },
                url: `https://cloudapi-oauth.suunto.com/oauth/deauthorize?client_id=${config.suuntoapp.client_id}`,
            });
        });

        it('should throw error if request fails', async () => {
            vi.mocked(requestPromise.get).mockRejectedValue(new Error('API Fail'));

            await expect(deauthorizeSuuntoUser('access-token'))
                .rejects.toThrow('API Fail');
        });
    });
});
