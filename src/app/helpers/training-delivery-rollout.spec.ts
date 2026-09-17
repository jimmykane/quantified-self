import { PLANNED_WORKOUT_PROVIDER_IDS, isPlannedWorkoutProviderDeliveryEnabled } from '@shared/planned-workout-providers';
import { isTrainingProviderDeliveryEnabled } from '@shared/training-delivery-rollout';

describe('Training delivery private rollout', () => {
  const pilotUid = 'xcsAolLDDTWTgtRN9eYF3lW2YKL2';

  it('permits Garmin, COROS, and Suunto only for the exact owner identity without enabling public delivery', () => {
    for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) {
      expect(isPlannedWorkoutProviderDeliveryEnabled(provider)).toBe(false);
      expect(isTrainingProviderDeliveryEnabled(provider, pilotUid)).toBe(['garmin', 'coros', 'suunto'].includes(provider));
    }
  });

  it.each([null, undefined, '', 'another-user', ` ${pilotUid}`, `${pilotUid} `, `${pilotUid}-other`, pilotUid.toLowerCase()])(
    'fails closed for non-pilot identity %s', uid => {
      for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) expect(isTrainingProviderDeliveryEnabled(provider, uid)).toBe(false);
    });
});
