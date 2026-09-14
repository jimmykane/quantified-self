import type { Firestore } from 'firebase-admin/firestore';
import { PLANNED_WORKOUT_PROVIDER_IDS } from '../../../../shared/planned-workout-providers';
import { productionDeliveryRuntime } from './runtime';

describe('Production Training delivery rollout', () => {
  const runtime = productionDeliveryRuntime({} as Firestore);

  it('constructs the real Garmin adapter only for the pilot UID without making requests', () => {
    for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) {
      const transport = runtime.transport(provider, 'xcsAolLDDTWTgtRN9eYF3lW2YKL2');
      if (provider === 'garmin') expect(transport?.mappingVersion).toBeTruthy();
      else expect(transport).toBeNull();
    }
  });

  it.each(['', 'another-user', ' xcsAolLDDTWTgtRN9eYF3lW2YKL2', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2 '])(
    'never binds a transport for non-pilot identity %s', uid => {
      for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) expect(runtime.transport(provider, uid)).toBeNull();
    });
});
