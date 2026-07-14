import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
    normalizeTrainingVisibleDisciplines,
    type SetTrainingVisibleDisciplinesRequest,
    type SetTrainingVisibleDisciplinesResponse,
} from '../../../shared/derived-metrics';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { getUserDeletionGuardState, getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { enforceAppCheck } from '../utils';

export function parseTrainingVisibleDisciplinesRequest(value: unknown): SetTrainingVisibleDisciplinesRequest {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, 'visibleDisciplines')) {
        throw new HttpsError('invalid-argument', 'visibleDisciplines is required.');
    }
    const visibleDisciplines = (value as Record<string, unknown>).visibleDisciplines;
    if (visibleDisciplines === null) {
        return { visibleDisciplines: null };
    }
    const normalized = normalizeTrainingVisibleDisciplines(visibleDisciplines);
    if (!normalized) {
        throw new HttpsError(
            'invalid-argument',
            'visibleDisciplines must contain one or more unique supported training disciplines.',
        );
    }
    return { visibleDisciplines: normalized };
}

export const setTrainingVisibleDisciplines = onCall({
    region: FUNCTIONS_MANIFEST.setTrainingVisibleDisciplines.region,
}, async (request): Promise<SetTrainingVisibleDisciplinesResponse> => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    enforceAppCheck(request);

    const { visibleDisciplines } = parseTrainingVisibleDisciplinesRequest(request.data);
    const uid = request.auth.uid;
    const db = admin.firestore();
    const deletionGuard = await getUserDeletionGuardState(db, uid);
    if (deletionGuard.shouldSkip) {
        throw new HttpsError('failed-precondition', 'This account is being deleted or is no longer available.');
    }

    try {
        await db.runTransaction(async (transaction) => {
            const writeDeletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
            if (writeDeletionGuard.shouldSkip) {
                throw new HttpsError('failed-precondition', 'This account is being deleted or is no longer available.');
            }
            transaction.set(db.doc(`users/${uid}/config/settings`), {
                trainingSettings: {
                    visibleDisciplines: visibleDisciplines === null
                        ? admin.firestore.FieldValue.delete()
                        : visibleDisciplines,
                },
            }, { merge: true });
        });
    } catch (error) {
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'Could not save the sports shown on Training.');
    }

    return { accepted: true, visibleDisciplines };
});
