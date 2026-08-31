import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import {
    SPORTS_LIB_REPARSE_CHECKPOINT_PATH,
    SPORTS_LIB_REPARSE_RUNTIME_SETTINGS_FIELD,
    validateSportsLibReparseTargetUid,
} from '../../reparse/sports-lib-reparse.config';
import { onAdminCall } from '../../shared/auth';
import {
    SetSportsLibReparseSettingsRequest,
    SetSportsLibReparseSettingsResponse,
} from '../shared/types';

function getErrorCode(error: unknown): string {
    if (!error || typeof error !== 'object' || !('code' in error)) {
        return '';
    }
    return `${(error as { code?: unknown }).code || ''}`;
}

export const setSportsLibReparseSettings = onAdminCall<
    SetSportsLibReparseSettingsRequest,
    SetSportsLibReparseSettingsResponse
>({
    region: FUNCTIONS_MANIFEST.setSportsLibReparseSettings.region,
    memory: '256MiB',
}, async (request) => {
    if (typeof request.data?.enabled !== 'boolean') {
        throw new HttpsError('invalid-argument', 'enabled must be a boolean.');
    }
    if (request.data.confirmGlobal !== undefined && typeof request.data.confirmGlobal !== 'boolean') {
        throw new HttpsError('invalid-argument', 'confirmGlobal must be a boolean when provided.');
    }

    const targetValidation = validateSportsLibReparseTargetUid(request.data.targetUid);
    if (!targetValidation.valid) {
        throw new HttpsError('invalid-argument', targetValidation.reason);
    }
    const targetUid = targetValidation.targetUid;
    if (request.data.enabled && !targetUid && request.data.confirmGlobal !== true) {
        throw new HttpsError(
            'failed-precondition',
            'Enabling a global reparse scan requires explicit confirmation.',
        );
    }

    if (request.data.enabled && targetUid) {
        try {
            await admin.auth().getUser(targetUid);
        } catch (error) {
            const errorCode = getErrorCode(error);
            if (errorCode === 'auth/user-not-found' || errorCode === 'user-not-found') {
                throw new HttpsError('not-found', 'The target user does not exist.');
            }
            logger.error('[admin/setSportsLibReparseSettings] Failed to validate target user.', {
                targetUid,
                errorCode: errorCode || null,
            });
            throw new HttpsError('internal', 'Failed to validate the target user.');
        }
    }

    const updatedBy = request.auth!.uid;
    try {
        await admin.firestore().doc(SPORTS_LIB_REPARSE_CHECKPOINT_PATH).set({
            [SPORTS_LIB_REPARSE_RUNTIME_SETTINGS_FIELD]: {
                enabled: request.data.enabled,
                targetUid,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy,
            },
        }, { merge: true });
    } catch (error) {
        logger.error('[admin/setSportsLibReparseSettings] Failed to persist runtime settings.', {
            enabled: request.data.enabled,
            targetUid,
            updatedBy,
            errorCode: getErrorCode(error) || null,
        });
        throw new HttpsError('internal', 'Failed to save sports-lib reparse settings.');
    }

    logger.info('[admin/setSportsLibReparseSettings] Updated runtime settings.', {
        enabled: request.data.enabled,
        targetUid,
        updatedBy,
    });

    return {
        success: true,
        settings: {
            enabled: request.data.enabled,
            targetUid,
            source: 'firestore',
            configurationValid: true,
            updatedAt: null,
            updatedBy,
        },
    };
});
