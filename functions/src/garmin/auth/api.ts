import * as logger from 'firebase-functions/logger';
import * as requestPromise from '../../request-helper';

/**
 * Fetches the Garmin User ID using the access token.
 * @param accessToken The OAuth2 access token.
 * @returns The Garmin User ID.
 * @throws Error if fetching fails or ID is missing.
 */
export async function getGarminUserId(accessToken: string): Promise<string> {
    try {
        const userResponse = await requestPromise.get({
            url: 'https://apis.garmin.com/wellness-api/rest/user/id',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const userData = typeof userResponse === 'string' ? JSON.parse(userResponse) : userResponse;
        if (userData && userData.userId) {
            return userData.userId;
        }
        throw new Error('User ID not found in response');
    } catch (e: any) {
        logger.error(`Failed to fetch Garmin User ID: ${e}`);
        throw new Error(`Failed to fetch Garmin User ID: ${e.message}`);
    }
}

/**
 * Fetches the granted permissions for the Garmin user.
 * @param accessToken The OAuth2 access token.
 * @returns Array of permissions or empty array if failed/missing.
 */
export async function getGarminPermissions(accessToken: string): Promise<string[]> {
    try {
        const permissionsResponse = await requestPromise.get({
            url: 'https://apis.garmin.com/wellness-api/rest/user/permissions',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const permissionsData = typeof permissionsResponse === 'string' ? JSON.parse(permissionsResponse) : permissionsResponse;
        if (permissionsData && Array.isArray(permissionsData.permissions)) {
            return permissionsData.permissions;
        }
        return [];
    } catch (e: any) {
        logger.error(`Failed to fetch Garmin Permissions: ${e}`);
        // Return empty array so strictly non-fatal, but logged
        return [];
    }
}

/**
 * Deauthorizes a user from the Garmin API.
 * @param accessToken The access token of the user to deauthorize.
 */
export async function deauthorizeGarminUser(accessToken: string): Promise<void> {
    try {
        await requestPromise.delete({
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
            url: 'https://apis.garmin.com/wellness-api/rest/user/registration',
        });
    } catch (e: any) {
        logger.error(`Failed to deauthorize Garmin user: ${e}`);
        throw e;
    }
}
