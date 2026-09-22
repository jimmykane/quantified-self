import * as admin from 'firebase-admin';
import { isTrainingProviderDeliveryEnabled } from '../../../../shared/training-delivery-rollout';
import { hasProAccess } from '../../utils';
import type { DeliveryOperation, DeliveryRuntime, TrainingDeliveryTransport } from './contracts';
import { readTrainingDeliveryAuthority } from './connection';
import { GarminTrainingTransport } from './garmin/transport';
import { createGarminTrainingClient } from './garmin/http';
import { authorizeGarminTrainingRequest } from './garmin/authorization';
import { GARMIN_PRODUCTION_WINDOWS, WAHOO_PRODUCTION_WINDOWS, productionRequestCapacity } from './request-capacity';
import { config } from '../../config';
import { SuuntoGuideTransport } from './suunto/transport';
import { createSuuntoGuideClient } from './suunto/http';
import { authorizeSuuntoGuideRequest } from './suunto/authorization';
import { validateGuideOwner } from './suunto/mapping';
import { CorosTrainingTransport } from './coros/transport';
import { createCorosTrainingClient } from './coros/http';
import { authorizeCorosTrainingRequest } from './coros/authorization';
import { reserveCorosIntegerIdentities } from './coros/identities';
import { WahooTrainingTransport } from './wahoo/transport';
import { createWahooTrainingClient } from './wahoo/http';
import { authorizeWahooTrainingRequest } from './wahoo/authorization';
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
    createSuuntoGuideClient(() => authorizeSuuntoGuideRequest(db, uid, operation), () => config.suuntoapp.subscription_key), owner);
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

function corosTransport(db: admin.firestore.Firestore, uid: string): TrainingDeliveryTransport {
  const bound = (operation: Pick<DeliveryOperation, 'destinationKey' | 'connectionGeneration'>) => new CorosTrainingTransport(
    createCorosTrainingClient(() => authorizeCorosTrainingRequest(db, uid, operation)));
  const policy = new CorosTrainingTransport(async () => { throw new Error('Unbound transport'); });
  return {
    mappingVersion: policy.mappingVersion,
    horizonDays: policy.horizonDays,
    assess: (workout, destination, zone) => policy.assess(workout, destination, zone),
    canRemove: (artifact, today) => policy.canRemove(artifact, today),
    execute: (operation, checkpoint, guard) => bound(operation).execute(operation, checkpoint, guard),
    recover: operation => bound(operation).recover(operation),
    batch: {
      maxSize: policy.batch.maxSize,
      reserveIdentities: reserveCorosIntegerIdentities,
      execute: (operations, beforeSend, guard) => bound(operations[0]).batch.execute(operations, beforeSend, guard),
    },
  };
}
function wahooTransport(db: admin.firestore.Firestore, uid: string): TrainingDeliveryTransport {
  const bound = (operation: Pick<DeliveryOperation, 'destinationKey' | 'connectionGeneration'>) => new WahooTrainingTransport(
    createWahooTrainingClient(() => authorizeWahooTrainingRequest(db, uid, operation), fetch, Date.now,
      productionRequestCapacity(db, uid, 'wahoo', operation.destinationKey, WAHOO_PRODUCTION_WINDOWS)));
  const policy = new WahooTrainingTransport(async () => { throw new Error('Unbound transport'); });
  return {
    mappingVersion: policy.mappingVersion, horizonDays: policy.horizonDays, withdrawOutsideHorizon: true,
    inspection: { policy: policy.inspection.policy, inspect: (request, guard) => bound(request).inspection.inspect(request, guard) },
    assess: (workout, destination, zone) => policy.assess(workout, destination, zone),
    canRemove: (artifact, today) => policy.canRemove(artifact, today),
    execute: (operation, checkpoint, guard) => bound(operation).execute(operation, checkpoint, guard),
    recover: (operation, checkpoint, guard) => bound(operation).recover(operation, checkpoint, guard),
  };
}
/** No environment/browser-selectable fake. Provider rollout comes only from the shared capability decision. */
export function productionDeliveryRuntime(db = admin.firestore()): DeliveryRuntime {
  return {
    db, now: Date.now, hasPro: hasProAccess,
    requestNotBefore: (tx, uid, provider, destination) => provider === 'garmin'
      ? productionRequestCapacity(db, uid, provider, destination, GARMIN_PRODUCTION_WINDOWS).notBefore(tx)
      : provider === 'wahoo' ? productionRequestCapacity(db, uid, provider, destination, WAHOO_PRODUCTION_WINDOWS).notBefore(tx) : Promise.resolve(0),
    transport: (provider, uid) => {
      if (!isTrainingProviderDeliveryEnabled(provider, uid)) return null;
      if (provider === 'garmin') return garminTransport(db, uid);
      if (provider === 'coros') return corosTransport(db, uid);
      if (provider === 'wahoo') return wahooTransport(db, uid);
      if (provider === 'suunto') {
        let owner: string;
        try { owner = validateGuideOwner(config.suuntoapp.application_name); } catch { return null; }
        return suuntoTransport(db, uid, owner);
      }
      return null;
    },
    connection: async (tx, uid, provider) => (await readTrainingDeliveryAuthority(db, tx, uid, provider)).connection,
  };
}
