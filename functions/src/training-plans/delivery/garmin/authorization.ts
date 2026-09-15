import type { Firestore } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getTokenData } from '../../../tokens';
import { getUserDeletionGuardStateInTransaction } from '../../../shared/user-deletion-guard';
import { readTrainingDeliveryAuthority, GARMIN_TRAINING_PERMISSION_ISSUE } from '../connection';
import { TrainingDeliveryTransportError, type DeliveryOperation } from '../contracts';

/** Reuses shared refresh leases and deletion/disconnect fencing. No cached credential
 * survives a request, and refreshed credentials must still represent the admitted account. */
export async function authorizeGarminTrainingRequest(db: Firestore, uid: string, operation: DeliveryOperation): Promise<string> {
  const read = () => db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) throw new TrainingDeliveryTransportError('auth');
    const authority = await readTrainingDeliveryAuthority(db, tx, uid, 'garmin');
    if (authority.connection.issues?.includes(GARMIN_TRAINING_PERMISSION_ISSUE)) throw new TrainingDeliveryTransportError('permission');
    if (authority.connection.state !== 'connected' || !authority.token
      || authority.connection.destinationKey !== operation.destinationKey
      || authority.connection.generation !== operation.connectionGeneration) throw new TrainingDeliveryTransportError('auth');
    return authority;
  });
  const authority = await read();
  let refreshed;
  try {
    refreshed = await getTokenData(authority.token!, ServiceNames.GarminAPI, false, {
      opaqueTelemetry: true, expectedActiveOAuthCredentialGeneration: authority.credentialGeneration,
    });
  } catch {
    // The shared lifecycle owns terminal-auth cleanup; refresh contention/outages must
    // not manufacture a reconnect requirement or leak provider exception contents here.
    throw new TrainingDeliveryTransportError('retryable');
  }
  const current = await read();
  if (current.account !== authority.account || current.token!.ref.path !== authority.token!.ref.path
    || current.credentialGeneration !== authority.credentialGeneration
    || !('userID' in refreshed) || refreshed.userID !== current.account) throw new TrainingDeliveryTransportError('auth');
  const accessToken = refreshed.accessToken;
  if (typeof accessToken !== 'string' || !accessToken || current.token!.data().accessToken !== accessToken
    || !(refreshed.expiresAt > Date.now())) throw new TrainingDeliveryTransportError('retryable');
  return accessToken;
}
