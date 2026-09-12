import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import { hasProAccess } from '../../utils';
import { deliveryIdentity } from './intent';
import { DELIVERY_STATE, type DeliveryRuntime } from './contracts';

export const DELIVERY_SERVICES = {
  garmin: { name: ServiceNames.GarminAPI, tokens: 'garminAPITokens', account: 'userID' },
  coros: { name: ServiceNames.COROSAPI, tokens: 'COROSAPIAccessTokens', account: 'openId' },
  wahoo: { name: ServiceNames.WahooAPI, tokens: 'wahooAPIAccessTokens', account: 'wahooUserID' },
  suunto: { name: ServiceNames.SuuntoApp, tokens: 'suuntoAppAccessTokens', account: 'userName' },
} as const;

/** There is deliberately no environment/config/browser selectable fake or HTTP adapter. */
export function productionDeliveryRuntime(db = admin.firestore()): DeliveryRuntime {
  return {
    db, now: Date.now, hasPro: hasProAccess,
    transport: () => null,
    connection: async (tx, uid, provider: PlannedWorkoutProviderId) => {
      const service = DELIVERY_SERVICES[provider];
      const user = db.collection('users').doc(uid);
      const rootRef = db.collection(service.tokens).doc(uid);
      const [metaDoc, rootDoc, tokens, stateDoc] = await Promise.all([
        tx.get(user.collection('meta').doc(service.name)), tx.get(rootRef),
        tx.get(rootRef.collection('tokens').limit(33)), tx.get(user.collection(DELIVERY_STATE).doc('current')),
      ]);
      const meta = metaDoc.data() ?? {};
      const root = rootDoc.data() ?? {};
      const epoch = stateDoc.data()?.connectionEpochs?.[provider] ?? 0;
      const generation = String(meta.connectionStateGeneration ?? '') + ':' + String(root.activeOAuthCredentialGeneration ?? '');
      const unavailable = { state: 'reconnect_required' as const, destinationKey: '', generation, epoch };
      if (meta.connectionState !== 'connected' || root.disconnectOperationGeneration || tokens.empty) return unavailable;
      const activeCredential = root.activeOAuthCredentialGeneration;
      const activeTokens = typeof activeCredential === 'string' && activeCredential.length > 0
        ? tokens.docs.filter(doc => doc.data().tokenCredentialGeneration === activeCredential) : [];
      const identities = new Set(activeTokens.map(doc => {
        const data = doc.data();
        const identity = String(data[service.account] ?? '').trim();
        return identity.length <= 512 ? identity : '';
      }).filter(Boolean));
      const pinned = String(meta.providerUserId ?? '').trim();
      const identity = pinned && identities.has(pinned) ? pinned : !pinned && identities.size === 1 ? [...identities][0] : '';
      if (!identity || identities.size !== 1 || tokens.size > 32) return { ...unavailable, state: 'connection_repair' as const };
      return { state: 'connected' as const, destinationKey: deliveryIdentity(uid, provider, identity, 'account'), generation, epoch };
    },
  };
}
