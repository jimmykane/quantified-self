import { PLANNED_WORKOUT_PROVIDER_IDS, isPlannedWorkoutProviderDeliveryEnabled } from '@shared/planned-workout-providers';
import { isTrainingProviderDeliveryEnabled } from '@shared/training-delivery-rollout';

describe('Training delivery rollout', () => {
  const pilotUid = 'xcsAolLDDTWTgtRN9eYF3lW2YKL2';

  it('enables Wahoo publicly while retaining the other providers for the exact pilot identity', () => {
    expect(isPlannedWorkoutProviderDeliveryEnabled('wahoo')).toBe(true);
    for (const provider of ['garmin', 'coros', 'suunto'] as const) {
      expect(isPlannedWorkoutProviderDeliveryEnabled(provider)).toBe(false);
    }
    for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) expect(isTrainingProviderDeliveryEnabled(provider, pilotUid)).toBe(true);
  });

  it.each([null, undefined, ''])('fails closed without an authenticated owner identity: %s', uid => {
    for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) expect(isTrainingProviderDeliveryEnabled(provider, uid)).toBe(false);
  });

  it.each(['another-user', ` ${pilotUid}`, `${pilotUid} `, `${pilotUid}-other`, pilotUid.toLowerCase()])(
    'enables only public Wahoo delivery for another authenticated identity %s', uid => {
      expect(isTrainingProviderDeliveryEnabled('wahoo', uid)).toBe(true);
      for (const provider of ['garmin', 'coros', 'suunto'] as const) {
        expect(isTrainingProviderDeliveryEnabled(provider, uid)).toBe(false);
      }
    });
});
