
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import * as requestPromise from '../request-helper';
import { config } from '../config';
import { GARMIN_HEALTH_API_TOKENS_COLLECTION_NAME } from './constants';
import * as crypto from 'crypto';
import OAuth from 'oauth-1.0a';

const TOKEN_EXCHANGE_URL = 'https://apis.garmin.com/partner-gateway/rest/user/token-exchange';

/**
 * Migrates a single user's token from OAuth 1.0 to OAuth 2.0
 */
export async function migrateUserToken(userID: string, oauth1Token: any) {
    if (!oauth1Token.accessToken || !oauth1Token.accessTokenSecret) {
        logger.warn(`Skipping migration for user ${userID} - Missing OAuth1 tokens`);
        return false;
    }

    // Check if already migrated
    // We check the subcollection 'tokens'
    const subCollection = await admin.firestore()
        .collection(GARMIN_HEALTH_API_TOKENS_COLLECTION_NAME)
        .doc(userID)
        .collection('tokens')
        .limit(1)
        .get();

    if (!subCollection.empty) {
        logger.info(`User ${userID} already has OAuth2 tokens.`);
        return true;
    }

    // 1. Generate PKCE Verifier and Challenge (S256)
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // 2. Call Token Exchange Endpoint
    // Signed using OAuth 1.0a
    const oauth = new OAuth({
        consumer: {
            key: config.garminhealthapi.client_id, // Consumer Key acts as Client ID
            secret: config.garminhealthapi.client_secret,
        },
        signature_method: 'HMAC-SHA1',
        hash_function(base_string, key) {
            return crypto
                .createHmac('sha1', key)
                .update(base_string)
                .digest('base64');
        },
    });

    const requestData = {
        url: TOKEN_EXCHANGE_URL,
        method: 'POST',
        data: {
            // Not parameters, just empty for signing? 
            // Or we sign the body params?
            // Usually OAuth1 signs the parameters.
            // URL params?
        }
    };

    // Garmin Guide: "POST parameters: oauth_token, oauth_token_secret, code_challenge"
    // So these must be included in the signature.

    const token = {
        key: oauth1Token.accessToken,
        secret: oauth1Token.accessTokenSecret,
    };

    // We put parameters in the FORM body, so they must be part of signature if content-type is form-urlencoded
    const formData = {
        oauth_token: oauth1Token.accessToken,
        oauth_token_secret: oauth1Token.accessTokenSecret,
        code_challenge: codeChallenge
        // code_challenge_method assumed S256? Or param?
        // Guide implies code_challenge is enough? 
        // Let's safe bet add method too if accepted, but strictly follow typical PKCE.
        // Actually, let's look at `wrapper.ts` or Plan?
        // Plan says: "Inputs: oauth_token, oauth_token_secret, code_challenge"
    };

    const authorization = oauth.toHeader(oauth.authorize({
        url: TOKEN_EXCHANGE_URL,
        method: 'POST',
        data: formData
    }, token));

    try {
        const response: any = await requestPromise.post({
            url: TOKEN_EXCHANGE_URL,
            headers: {
                ...authorization,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            form: formData
        });

        const tokens = typeof response === 'string' ? JSON.parse(response) : response;

        // 3. Save new tokens to Subcollection
        // Calculate expiresAt as numeric timestamp (ms) with 600s buffer per Garmin recommendation
        const currentDate = new Date();
        const expiresAt = currentDate.getTime() + ((tokens.expires_in || 86400) * 1000) - 600000;

        // Use the userID from the response if available, or fallback to the key provided (legacy user)
        // Does response contain user id?
        // "Outputs: access_token, refresh_token, scope"
        // It might not return user ID.
        // But we know the user ID from the old token (the Firestore DOC ID).
        const garminUserID = userID; // In legacy, doc ID IS garmin user ID.

        await admin.firestore()
            .collection(GARMIN_HEALTH_API_TOKENS_COLLECTION_NAME)
            .doc(userID) // Parent Doc
            .collection('tokens')
            .doc(garminUserID)
            .set({
                serviceName: 'GarminHealthAPI',
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt: expiresAt,
                // We keep scope?
                scope: tokens.scope || 'workout',
                userID: garminUserID,
                tokenType: 'Bearer',
                dateCreated: currentDate.getTime(),
                dateRefreshed: currentDate.getTime(),
                migratedAt: admin.firestore.FieldValue.serverTimestamp()
            });

        logger.info(`Successfully migrated tokens for user ${userID}`);
        return true;

    } catch (e: any) {
        logger.error(`Migration failed for user ${userID}: ${e.message}`, e);
        return false;
    }
}

// HTTP Trigger

