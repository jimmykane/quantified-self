import * as admin from 'firebase-admin';
import { isTrainingProviderDeliveryEnabled } from '../../../../shared/training-delivery-rollout';
import { hasProAccess } from '../../utils';
import type { DeliveryOperation, DeliveryRuntime, TrainingDeliveryTransport } from './contracts';
import { readTrainingDeliveryAuthority } from './connection';
import { GarminTrainingTransport } from './garmin/transport';
import { createGarminTrainingClient } from './garmin/http';
import { authorizeGarminTrainingRequest } from './garmin/authorization';
import { GARMIN_PRODUCTION_WINDOWS, productionRequestCapacity } from './request-capacity';
import { config } from '../../config';
import { SuuntoGuideTransport } from './suunto/transport';
import { createSuuntoGuideClient } from './suunto/http';
import { authorizeSuuntoGuideRequest } from './suunto/authorization';
import { validateGuideOwner } from './suunto/mapping';
export { DELIVERY_SERVICES } from './connection';

function garminTransport(db: admin.firestore.Firestore, uid: string): TrainingDeliveryTransport {
  const bound = (operation: Pick<DeliveryOperation, 'destinationKey' | 'connectionGeneration'>) => new GarminTrainingTransport(
    createGarminTrainingClient(() => authorizeGarminTrainingRequest(db, uid, operation), fetch, Date.now,
      productionRequestCapacity(db, uid, 'garmin', operation.destinationKey, GARMIN_PRODUCTION_WINDOWS)));
  const policy = new GarminTrainingTransport(async () => { throw new Error('Unbound transport'); });
  return {
    mappingVersion: policy.mappingVersion, horizonDays: policy.horizonDays,
    inspection: { policy: policy.inspection.policy, inspect: (request, guard) => bound(request).inspection.inspect(request, guard) },
    assess: (workout, destination, zone) => policy.assess(workout, destination, zone),
    canRemove: (artifact, today) => policy.canRemove(artifact, today),
    execute: (operation, checkpoint, guard) => bound(operation).execute(operation, checkpoint, guard),
    recover: (operation, checkpoint, guard) => bound(operation).recover(operation, checkpoint, guard),
  };
}

function suuntoTransport(db: admin.firestore.Firestore, uid: string, owner: string): TrainingDeliveryTransport {
  const bound = (operation: Pick<DeliveryOperation, 'destinationKey' | 'connectionGeneration'>) => new SuuntoGuideTransport(
    createSuuntoGuideClient(() => authorizeSuuntoGuideRequest(db, uid, operation), () => config.suuntoapp.guides_subscription_key), owner);
  const policy = new SuuntoGuideTransport(async () => { throw new Error('Unbound transport'); }, owner);
  return {
    mappingVersion: policy.mappingVersion, horizonDays: policy.horizonDays, withdrawOutsideHorizon: true,
    inspection: { policy: policy.inspection.policy, inspect: (request, guard) => bound(request).inspection.inspect(request, guard) },
    assess: (workout, destination, zone) => policy.assess(workout, destination, zone),
    canRemove: (artifact, today) => policy.canRemove(artifact, today),
    execute: (operation, checkpoint, guard) => bound(operation).execute(operation, checkpoint, guard),
    recover: (operation, checkpoint, guard) => bound(operation).recover(operation, checkpoint, guard),
  };
}
/** No environment/browser-selectable fake. Public delivery remains disabled. */
export function productionDeliveryRuntime(db = admin.firestore()): DeliveryRuntime {
  return {
    db, now: Date.now, hasPro: hasProAccess,
    requestNotBefore: (tx, uid, provider, destination) => provider === 'garmin'
      ? productionRequestCapacity(db, uid, provider, destination, GARMIN_PRODUCTION_WINDOWS).notBefore(tx) : Promise.resolve(0),
    transport: (provider, uid) => {
      if (!isTrainingProviderDeliveryEnabled(provider, uid)) return null;
      if (provider === 'garmin') return garminTransport(db, uid);
      // Non-secret, exact OAuth application name. Missing configuration does not
      // invent ownership or prevent another provider's worker from running.
      const owner = process.env.SUUNTOAPP_GUIDE_OWNER;
      if (provider === 'suunto' && owner) {
        try { validateGuideOwner(owner); } catch { return null; }
        return suuntoTransport(db, uid, owner);
      }
      return null;
    },
    connection: async (tx, uid, provider) => (await readTrainingDeliveryAuthority(db, tx, uid, provider)).connection,
  };
}
