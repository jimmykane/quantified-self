import type { Firestore } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getTokenData } from '../../../tokens';
import { getUserDeletionGuardStateInTransaction } from '../../../shared/user-deletion-guard';
import { assertWahooActiveAccountGuardCurrent, captureWahooActiveAccountGuard } from '../../../wahoo/account';
import { isWahooReconnectRequiredError, isWahooRefreshBackoffError } from '../../../wahoo/refresh-recovery';
import { WAHOO_TRAINING_PERMISSION_ISSUE } from '../../../../../shared/wahoo-training';
import { readTrainingDeliveryAuthority } from '../connection';
import { TrainingDeliveryTransportError, type DeliveryOperation } from '../contracts';

function failure(error: unknown): TrainingDeliveryTransportError {
  if (error instanceof TrainingDeliveryTransportError) return error;
  if (isWahooRefreshBackoffError(error)) return new TrainingDeliveryTransportError('deferred', Math.max(0, error.retryAt - Date.now()));
  if (isWahooReconnectRequiredError(error)) return new TrainingDeliveryTransportError('auth');
  // Credential rotation/refresh contention is transient, not revoked consent.
  return new TrainingDeliveryTransportError('retryable');
}
export async function authorizeWahooTrainingRequest(db: Firestore, uid: string,
  operation: Pick<DeliveryOperation, 'destinationKey' | 'connectionGeneration'>) {
  const read = () => db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) throw new TrainingDeliveryTransportError('auth');
    const authority = await readTrainingDeliveryAuthority(db, tx, uid, 'wahoo');
    if (authority.connection.issues?.includes(WAHOO_TRAINING_PERMISSION_ISSUE)) throw new TrainingDeliveryTransportError('permission');
    if (authority.connection.state !== 'connected' || !authority.token
      || authority.connection.destinationKey !== operation.destinationKey
      || authority.connection.generation !== operation.connectionGeneration) throw new TrainingDeliveryTransportError('auth');
    return authority;
  });
  try {
    const authority = await read();
    // Wahoo explicitly excludes token refresh from API quotas. The normal Wahoo
    // refresh lease, cooldown and terminal-auth cleanup stay authoritative.
    const token = await getTokenData(authority.token!, ServiceNames.WahooAPI, false, {
      opaqueTelemetry: true, expectedActiveOAuthCredentialGeneration: authority.credentialGeneration || null,
    });
    const current = await read();
    if (current.account !== authority.account || current.token!.ref.path !== authority.token!.ref.path
      || !('wahooUserID' in token) || token.wahooUserID !== current.account) throw new TrainingDeliveryTransportError('auth');
    if (!token.accessToken || current.token!.data().accessToken !== token.accessToken || !(token.expiresAt > Date.now())) {
      throw new TrainingDeliveryTransportError('retryable');
    }
    const accountGuard = await captureWahooActiveAccountGuard(uid, current.account, token.accessToken);
    return { accessToken: token.accessToken, account: current.account, assertCurrent: async () => {
      try { await read(); await assertWahooActiveAccountGuardCurrent(uid, accountGuard); }
      catch (error) { throw failure(error); }
    } };
  } catch (error) { throw failure(error); }
}
