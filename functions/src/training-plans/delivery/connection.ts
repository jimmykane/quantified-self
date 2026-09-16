import type { Firestore, QueryDocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import { getMissingGarminPermissionsForTokenLike } from '../../../../shared/garmin-service-token';
import { isServiceDisconnectPendingData } from '../../service-disconnect-pending-state';
import { deliveryIdentity } from './intent';
import { DELIVERY_STATE, type DeliveryConnection } from './contracts';
import { doesSuuntoHealthWebhookBindingMatch, getSuuntoHealthWebhookAccountBindingRef,
  parseSuuntoHealthWebhookAccountBinding } from '../../suunto/health-webhook-binding';

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
  if (provider === 'suunto') {
    const repair = { ...unavailable, connection: { ...unavailable.connection, state: 'connection_repair' as const } };
    if (!credentialGeneration || typeof meta.connectionStateGeneration !== 'string' || !meta.connectionStateGeneration
      || tokens.size > 32 || (meta.providerUserId !== undefined
        && (typeof meta.providerUserId !== 'string' || !meta.providerUserId || meta.providerUserId !== meta.providerUserId.trim()))) return repair;
    // Suunto retains multiple accounts. The latest root OAuth revision fences all
    // requests; an older account's own token generation must NOT equal that root.
    const candidates = tokens.docs.filter(doc => {
      const data = doc.data();
      return typeof data.userName === 'string' && data.userName === data.userName.trim() && data.userName.length > 0
        && data.userName.length <= 512 && doc.id === data.userName && data.serviceName === service.name
        && typeof data.tokenCredentialGeneration === 'string' && data.tokenCredentialGeneration.length > 0;
    });
    const pinned = typeof meta.providerUserId === 'string' ? meta.providerUserId : '';
    const selected = pinned ? candidates.filter(doc => doc.data().userName === pinned) : candidates;
    if (selected.length !== 1) return repair;
    const token = selected[0]; const account = token.data().userName as string;
    const binding = parseSuuntoHealthWebhookAccountBinding((await tx.get(getSuuntoHealthWebhookAccountBindingRef(db, account, uid))).data());
    if (!doesSuuntoHealthWebhookBindingMatch(binding, uid, account, token.data().tokenCredentialGeneration)) return repair;
    return { account, token, credentialGeneration, connection: { state: 'connected', epoch,
      generation: `${generation}:${token.data().tokenCredentialGeneration}`,
      destinationKey: deliveryIdentity(uid, provider, account, 'account') } };
  }
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
