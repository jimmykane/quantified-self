import type { Firestore } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getTokenData } from '../../../tokens';
import { getUserDeletionGuardStateInTransaction } from '../../../shared/user-deletion-guard';
import { readTrainingDeliveryAuthority } from '../connection';
import { TrainingDeliveryTransportError, type DeliveryOperation } from '../contracts';

export async function authorizeSuuntoGuideRequest(db: Firestore, uid: string,
  operation: Pick<DeliveryOperation, 'destinationKey' | 'connectionGeneration'>): Promise<{ accessToken: string; account: string }> {
  const read = () => db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) throw new TrainingDeliveryTransportError('auth');
    const authority = await readTrainingDeliveryAuthority(db, tx, uid, 'suunto');
    if (authority.connection.state !== 'connected' || !authority.token
      || authority.connection.destinationKey !== operation.destinationKey
      || authority.connection.generation !== operation.connectionGeneration) throw new TrainingDeliveryTransportError('auth');
    return authority;
  });
  const before = await read(); let refreshed;
  try {
    refreshed = await getTokenData(before.token!, ServiceNames.SuuntoApp, false, {
      opaqueTelemetry: true, expectedActiveOAuthCredentialGeneration: before.credentialGeneration,
    });
  } catch { throw new TrainingDeliveryTransportError('retryable'); }
  const after = await read();
  if (after.account !== before.account || after.token!.ref.path !== before.token!.ref.path
    || after.credentialGeneration !== before.credentialGeneration || !('userName' in refreshed)
    || refreshed.userName !== after.account) throw new TrainingDeliveryTransportError('auth');
  if (typeof refreshed.accessToken !== 'string' || !refreshed.accessToken || !Number.isFinite(refreshed.expiresAt) || !(refreshed.expiresAt > Date.now())
    || after.token!.data().accessToken !== refreshed.accessToken) throw new TrainingDeliveryTransportError('retryable');
  return { accessToken: refreshed.accessToken, account: after.account };
}
