import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { isConnectionHistoryRunId } from '../connection-history/model';

const IMPORT_BUILD_INTERVAL_MS = 5 * 60_000;
const IMPORT_CHECKPOINT_MAX_AGE_MS = 15 * 60_000;
const HISTORY_SERVICES = [ServiceNames.SuuntoApp, ServiceNames.GarminAPI, ServiceNames.COROSAPI, ServiceNames.WahooAPI];

export function isDerivedImportService(value: unknown): value is ServiceNames {
    return HISTORY_SERVICES.some(service => service === value);
}

/** Called only when scheduling a new background generation, never for each source write. */
export async function derivedImportBuildIntervalMs(
    transaction: FirebaseFirestore.Transaction,
    uid: string,
    nowMs: number,
    ordinaryIntervalMs: number,
): Promise<number> {
    const db = admin.firestore();
    const snapshots = await transaction.getAll(
        ...HISTORY_SERVICES.map(service => db.doc(`users/${uid}/meta/${service}`)),
        { fieldMask: ['connectionHistoryImport'] },
    );
    const active = snapshots.some(snapshot => {
        const history = snapshot.data()?.connectionHistoryImport;
        return history?.active === true
            && isConnectionHistoryRunId(history.runId)
            && Number.isSafeInteger(history.updatedAtMs)
            && history.updatedAtMs <= nowMs
            && history.updatedAtMs >= nowMs - IMPORT_CHECKPOINT_MAX_AGE_MS;
    });
    return active ? IMPORT_BUILD_INTERVAL_MS : ordinaryIntervalMs;
}
