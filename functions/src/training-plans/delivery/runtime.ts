import * as admin from 'firebase-admin';
import { isTrainingProviderDeliveryEnabled } from '../../../../shared/training-delivery-rollout';
import { hasProAccess } from '../../utils';
import type { DeliveryOperation, DeliveryRuntime, TrainingDeliveryTransport } from './contracts';
import { readTrainingDeliveryAuthority } from './connection';
import { GarminTrainingTransport } from './garmin/transport';
import { createGarminTrainingClient } from './garmin/http';
import { authorizeGarminTrainingRequest } from './garmin/authorization';
export { DELIVERY_SERVICES } from './connection';

function garminTransport(db: admin.firestore.Firestore, uid: string): TrainingDeliveryTransport {
  const bound = (operation: DeliveryOperation) => new GarminTrainingTransport(
    createGarminTrainingClient(() => authorizeGarminTrainingRequest(db, uid, operation)));
  const policy = new GarminTrainingTransport(async () => { throw new Error('Unbound transport'); });
  return {
    mappingVersion: policy.mappingVersion, horizonDays: policy.horizonDays,
    assess: (workout, destination, zone) => policy.assess(workout, destination, zone),
    canRemove: (artifact, today) => policy.canRemove(artifact, today),
    execute: (operation, checkpoint, guard) => bound(operation).execute(operation, checkpoint, guard),
    recover: (operation, checkpoint, guard) => bound(operation).recover(operation, checkpoint, guard),
  };
}

/** No environment/browser-selectable fake. Public delivery remains disabled;
 * only the reviewed UID pilot can exercise Garmin before certification. */
export function productionDeliveryRuntime(db = admin.firestore()): DeliveryRuntime {
  return {
    db, now: Date.now, hasPro: hasProAccess,
    transport: (provider, uid) => provider === 'garmin' && isTrainingProviderDeliveryEnabled(provider, uid) ? garminTransport(db, uid) : null,
    connection: async (tx, uid, provider) => (await readTrainingDeliveryAuthority(db, tx, uid, provider)).connection,
  };
}
