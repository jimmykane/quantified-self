import * as requestPromise from '../../request-helper';
import * as logger from 'firebase-functions/logger';

export async function getCOROSUserId(accessToken: string): Promise<string> {
    try {
        const userResponse = await requestPromise.get({
            url: 'https://open.coros.com/v2/user',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        const userData = typeof userResponse === 'string' ? JSON.parse(userResponse) : userResponse;

        if (userData && userData.data && userData.data.openId) {
            return userData.data.openId;
        }

        throw new Error('User ID (openId) not found in response');
    } catch (e: any) {
        logger.error(`Failed to fetch COROS User ID: ${e}`);
        throw new Error(`Failed to fetch COROS User ID: ${e.message}`);
    }
}

/**
 * Deauthorizes a user from the COROS API.
 * @param accessToken The access token of the user to deauthorize.
 */
export async function deauthorizeCOROSUser(accessToken: string): Promise<void> {
    try {
        await requestPromise.post({
            url: `https://open.coros.com/oauth2/deauthorize?token=${accessToken}`,
        });
    } catch (e: any) {
        logger.error(`Failed to deauthorize COROS user: ${e}`);
        throw e;
    }
}
