import * as requestPromise from '../../request-helper';
import * as logger from 'firebase-functions/logger';
import { config } from '../../config';

/**
 * Deauthorizes a user from the Suunto API.
 * @param accessToken The access token of the user to deauthorize.
 */
export async function deauthorizeSuuntoUser(accessToken: string): Promise<void> {
    try {
        await requestPromise.get({
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
            url: `https://cloudapi-oauth.suunto.com/oauth/deauthorize?client_id=${config.suuntoapp.client_id}`,
        });
    } catch (e: any) {
        logger.error(`Failed to deauthorize Suunto user: ${e}`);
        throw e;
    }
}
