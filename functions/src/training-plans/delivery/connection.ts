import type { Firestore, QueryDocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import { getMissingGarminPermissionsForTokenLike } from '../../../../shared/garmin-service-token';
import { isServiceDisconnectPendingData } from '../../service-disconnect-pending-state';
import { deliveryIdentity } from './intent';
import { DELIVERY_STATE, type DeliveryConnection } from './contracts';
import { doesSuuntoHealthWebhookBindingMatch, getSuuntoHealthWebhookAccountBindingRef,
  parseSuuntoHealthWebhookAccountBinding } from '../../suunto/health-webhook-binding';
import { doesOAuthCredentialGenerationAuthorizeToken } from '../../token-refresh-coordinator';
import { normalizeCOROSOpenId, selectActiveCOROSTokenSnapshot } from '../../coros/account';
import { normalizeWahooUserID, selectActiveWahooTokenSnapshot } from '../../wahoo/account';
import { hasWahooTrainingScopes, WAHOO_TRAINING_PERMISSION_ISSUE } from '../../../../shared/wahoo-training';

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
  if (provider === 'wahoo') {
    const repair = { ...unavailable, connection: { ...unavailable.connection, state: 'connection_repair' as const } };
    const pinned = normalizeWahooUserID(meta.providerUserId);
    const hasPin = meta.providerUserId !== undefined && meta.providerUserId !== null && meta.providerUserId !== '';
    if (tokens.size > 32 || (hasPin && !pinned)) return repair;
    // Use the same pin/latest-token ordering as all other Wahoo consumers. Never
    // skip a malformed selected token and silently choose another retained account.
    const token = pinned ? tokens.docs.find(doc => doc.id === pinned) : selectActiveWahooTokenSnapshot(tokens.docs);
    const account = normalizeWahooUserID(token?.data().wahooUserID);
    if (!token || !account || token.id !== account
      || !doesOAuthCredentialGenerationAuthorizeToken(root, token.data().tokenCredentialGeneration)) return repair;
    const connection: DeliveryConnection = { state: 'connected', epoch,
      generation: `${generation}:${token.data().tokenCredentialGeneration ?? ''}`,
      destinationKey: deliveryIdentity(uid, provider, account, 'account') };
    if (!hasWahooTrainingScopes(token.data().scope)) return { ...repair, account,
      connection: { ...connection, state: 'connection_repair', issues: [WAHOO_TRAINING_PERMISSION_ISSUE] } };
    return { account, token, credentialGeneration, connection };
  }
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
    // A malformed retained token is not proof that its account no longer exists.
    // Without an authoritative selection, never silently fall back to the sole
    // well-formed account when another retained account cannot be validated.
    if (!pinned && tokens.size !== 1) return repair;
    const selected = pinned ? candidates.filter(doc => doc.data().userName === pinned) : candidates;
    if (selected.length !== 1) return repair;
    const token = selected[0]; const account = token.data().userName as string;
    const binding = parseSuuntoHealthWebhookAccountBinding((await tx.get(getSuuntoHealthWebhookAccountBindingRef(db, account, uid))).data());
    if (!doesSuuntoHealthWebhookBindingMatch(binding, uid, account, token.data().tokenCredentialGeneration)) return repair;
    return { account, token, credentialGeneration, connection: { state: 'connected', epoch,
      generation: `${generation}:${token.data().tokenCredentialGeneration}`,
      destinationKey: deliveryIdentity(uid, provider, account, 'account') } };
  }
  const active = provider === 'coros'
    ? tokens.docs.filter(doc => doesOAuthCredentialGenerationAuthorizeToken(root, doc.data().tokenCredentialGeneration))
    : credentialGeneration ? tokens.docs.filter(doc => doc.data().tokenCredentialGeneration === credentialGeneration) : [];
  // Garmin adds strict identity validation; do not change another provider's existing
  // scalar normalization while extracting the common authority reader for this adapter.
  const identity = (value: unknown) => provider === 'garmin' ? typeof value === 'string' ? value.trim() : ''
    : provider === 'coros' ? normalizeCOROSOpenId(value) ?? '' : String(value ?? '').trim();
  const wellFormedActive = active.filter(doc => {
    if (provider !== 'coros') return true;
    const data = doc.data();
    const account = identity(data[service.account] ?? doc.id);
    return !!account && doc.id === account
      && (data[service.account] === undefined || identity(data[service.account]) === account);
  });
  const identities = new Set(wellFormedActive.map(doc => {
    const value = identity(doc.data()[service.account] ?? (provider === 'coros' ? doc.id : undefined));
    return value.length <= 512 ? value : '';
  }).filter(Boolean));
  const pinned = identity(meta.providerUserId);
  const invalidCorosPin = provider === 'coros'
    && meta.providerUserId !== undefined && meta.providerUserId !== null && meta.providerUserId !== '' && !pinned;
  // Match the canonical COROS account selector: an explicit pin wins; otherwise
  // use its deterministic latest-token ordering. Do not silently fall through
  // from a malformed selected token to another retained account.
  const selectedCorosToken = provider === 'coros'
    ? pinned
      ? tokens.docs.find(doc => doc.id === pinned) ?? null
      : selectActiveCOROSTokenSnapshot(tokens.docs)
    : null;
  const selectedCorosAccount = selectedCorosToken
    ? identity(selectedCorosToken.data()[service.account] ?? selectedCorosToken.id)
    : '';
  const account = provider === 'coros'
    ? selectedCorosAccount
    : pinned && identities.has(pinned) ? pinned : !pinned && identities.size === 1 ? [...identities][0] : '';
  const selectedCandidates = account
    ? wellFormedActive.filter(doc => identity(doc.data()[service.account] ?? (provider === 'coros' ? doc.id : undefined)) === account)
    : [];
  const corosAuthorityIsUnambiguous = provider !== 'coros'
    || (selectedCandidates.length === 1 && selectedCandidates[0].id === selectedCorosToken?.id);
  if (!account || tokens.size > 32 || invalidCorosPin || !corosAuthorityIsUnambiguous
    || (provider !== 'coros' && identities.size !== 1) || (provider === 'garmin'
    && (active.length !== 1 || active[0].data().serviceName !== service.name || !meta.connectionStateGeneration))) {
    return { ...unavailable, connection: { ...unavailable.connection, state: 'connection_repair' } };
  }
  const selected = selectedCandidates[0] ?? null;
  const selectedTokenGeneration = typeof selected?.data().tokenCredentialGeneration === 'string'
    ? selected.data().tokenCredentialGeneration : '';
  const connection: DeliveryConnection = { state: 'connected', destinationKey: deliveryIdentity(uid, provider, account, 'account'),
    generation: provider === 'coros' ? `${generation}:${selectedTokenGeneration}` : generation, epoch };
  if (provider === 'garmin' && getMissingGarminPermissionsForTokenLike(active[0].data(), ['WORKOUT_IMPORT']).length) {
    return { ...unavailable, account, connection: { ...connection, state: 'connection_repair', issues: [GARMIN_TRAINING_PERMISSION_ISSUE] } };
  }
  return { connection, token: selected, account, credentialGeneration };
}
