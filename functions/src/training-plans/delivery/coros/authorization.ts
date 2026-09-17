import type { Firestore } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getTokenData } from '../../../tokens';
import { getUserDeletionGuardStateInTransaction } from '../../../shared/user-deletion-guard';
import { isTerminalServiceAuthError } from '../../../shared/provider-operation-error';
import { readTrainingDeliveryAuthority } from '../connection';
import { TrainingDeliveryTransportError, type DeliveryOperation } from '../contracts';
import { normalizeCOROSOpenId } from '../../../coros/account';

export interface CorosTrainingAuthority {
  accessToken: string;
  account: string;
}

/** Resolves and refreshes the exact server-owned COROS account admitted by the
 * delivery ledger. Both absent generations and matching generations use
 * the same canonical authority rule in readTrainingDeliveryAuthority. */
export async function authorizeCorosTrainingRequest(db: Firestore, uid: string,
  operation: Pick<DeliveryOperation, 'destinationKey' | 'connectionGeneration'>): Promise<CorosTrainingAuthority> {
  const read = () => db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) throw new TrainingDeliveryTransportError('auth');
    const authority = await readTrainingDeliveryAuthority(db, tx, uid, 'coros');
    if (authority.connection.state !== 'connected' || !authority.token
      || authority.connection.destinationKey !== operation.destinationKey
      || authority.connection.generation !== operation.connectionGeneration) throw new TrainingDeliveryTransportError('auth');
    return authority;
  });
  const before = await read();
  let refreshed;
  try {
    refreshed = await getTokenData(before.token!, ServiceNames.COROSAPI, false, {
      opaqueTelemetry: true,
      expectedActiveOAuthCredentialGeneration: before.credentialGeneration || null,
    });
  } catch (error) {
    throw new TrainingDeliveryTransportError(isTerminalServiceAuthError(error) ? 'auth' : 'retryable');
  }
  const after = await read();
  const account = normalizeCOROSOpenId(after.account);
  const refreshedAccount = 'openId' in refreshed ? normalizeCOROSOpenId(refreshed.openId) : null;
  if (!account || account !== before.account || refreshedAccount !== account
    || after.token!.ref.path !== before.token!.ref.path
    || after.connection.generation !== before.connection.generation) throw new TrainingDeliveryTransportError('auth');
  if (typeof refreshed.accessToken !== 'string' || !refreshed.accessToken
    || !Number.isFinite(refreshed.expiresAt) || !(refreshed.expiresAt > Date.now())
    || after.token!.data().accessToken !== refreshed.accessToken) throw new TrainingDeliveryTransportError('retryable');
  return { accessToken: refreshed.accessToken, account };
}
