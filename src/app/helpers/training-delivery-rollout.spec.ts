import { PLANNED_WORKOUT_PROVIDER_IDS, isPlannedWorkoutProviderDeliveryEnabled } from '@shared/planned-workout-providers';
import { isTrainingProviderDeliveryEnabled } from '@shared/training-delivery-rollout';

describe('Training delivery rollout', () => {
  it('enables every provider for any authenticated owner identity', () => {
    for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) {
      expect(isPlannedWorkoutProviderDeliveryEnabled(provider)).toBe(true);
      expect(isTrainingProviderDeliveryEnabled(provider, 'owner')).toBe(true);
      expect(isTrainingProviderDeliveryEnabled(provider, 'another-user')).toBe(true);
    }
  });

  it.each([null, undefined, ''])('fails closed without an authenticated owner identity: %s', uid => {
    for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) expect(isTrainingProviderDeliveryEnabled(provider, uid)).toBe(false);
  });

  it.each(['another-user', ' owner', 'owner ', 'owner-other'])(
    'does not use an identity allowlist for authenticated identity %s', uid => {
      for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) expect(isTrainingProviderDeliveryEnabled(provider, uid)).toBe(true);
    });
});
