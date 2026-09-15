import type { Firestore, QueryDocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import { getMissingGarminPermissionsForTokenLike } from '../../../../shared/garmin-service-token';
import { isServiceDisconnectPendingData } from '../../service-disconnect-pending-state';
import { deliveryIdentity } from './intent';
import { DELIVERY_STATE, type DeliveryConnection } from './contracts';

export const GARMIN_TRAINING_PERMISSION_ISSUE = 'Garmin Training permission is required. Reconnect Garmin and allow training workouts.';
export const DELIVERY_SERVICES = {
  garmin: { name: ServiceNames.GarminAPI, tokens: 'garminAPITokens', account: 'userID' },
  coros: { name: ServiceNames.COROSAPI, tokens: 'COROSAPIAccessTokens', account: 'openId' },
  wahoo: { name: ServiceNames.WahooAPI, tokens: 'wahooAPIAccessTokens', account: 'wahooUserID' },
  suunto: { name: ServiceNames.SuuntoApp, tokens: 'suuntoAppAccessTokens', account: 'userName' },
} as const;
export interface TrainingDeliveryAuthority {
  connection: DeliveryConnection;
  token: QueryDocumentSnapshot | null;
  account: string;
  credentialGeneration: string;
}

/** One transaction owns destination resolution and the exact credential snapshot.
 * Returned authority is server-only; commands expose only the existing safe projection. */
export async function readTrainingDeliveryAuthority(db: Firestore, tx: Transaction, uid: string,
  provider: PlannedWorkoutProviderId): Promise<TrainingDeliveryAuthority> {
  const service = DELIVERY_SERVICES[provider];
  const user = db.collection('users').doc(uid);
  const rootRef = db.collection(service.tokens).doc(uid);
  const [metaDoc, rootDoc, tokens, stateDoc] = await Promise.all([
    tx.get(user.collection('meta').doc(service.name)), tx.get(rootRef),
    tx.get(rootRef.collection('tokens').limit(33)), tx.get(user.collection(DELIVERY_STATE).doc('current')),
  ]);
  const meta = metaDoc.data() ?? {}; const root = rootDoc.data() ?? {};
  const epoch = stateDoc.data()?.connectionEpochs?.[provider] ?? 0;
  const credentialGeneration = typeof root.activeOAuthCredentialGeneration === 'string' ? root.activeOAuthCredentialGeneration : '';
  const generation = String(meta.connectionStateGeneration ?? '') + ':' + credentialGeneration;
  const unavailable: TrainingDeliveryAuthority = { connection: { state: 'reconnect_required', destinationKey: '', generation, epoch },
    token: null, account: '', credentialGeneration };
  if (!rootDoc.exists || meta.connectionState !== 'connected' || root.disconnectOperationGeneration
    || isServiceDisconnectPendingData(root) || tokens.empty) return unavailable;
  const active = credentialGeneration ? tokens.docs.filter(doc => doc.data().tokenCredentialGeneration === credentialGeneration) : [];
  // Garmin adds strict identity validation; do not change another provider's existing
  // scalar normalization while extracting the common authority reader for this adapter.
  const identity = (value: unknown) => provider === 'garmin' ? typeof value === 'string' ? value.trim() : '' : String(value ?? '').trim();
  const identities = new Set(active.map(doc => {
    const value = identity(doc.data()[service.account]);
    return value.length <= 512 ? value : '';
  }).filter(Boolean));
  const pinned = identity(meta.providerUserId);
  const account = pinned && identities.has(pinned) ? pinned : !pinned && identities.size === 1 ? [...identities][0] : '';
  if (!account || identities.size !== 1 || tokens.size > 32 || (provider === 'garmin'
    && (active.length !== 1 || active[0].data().serviceName !== service.name || !meta.connectionStateGeneration))) {
    return { ...unavailable, connection: { ...unavailable.connection, state: 'connection_repair' } };
  }
  const connection: DeliveryConnection = { state: 'connected', destinationKey: deliveryIdentity(uid, provider, account, 'account'), generation, epoch };
  if (provider === 'garmin' && getMissingGarminPermissionsForTokenLike(active[0].data(), ['WORKOUT_IMPORT']).length) {
    return { ...unavailable, account, connection: { ...connection, state: 'connection_repair', issues: [GARMIN_TRAINING_PERMISSION_ISSUE] } };
  }
  return { connection, token: active.length === 1 ? active[0] : null, account, credentialGeneration };
}
