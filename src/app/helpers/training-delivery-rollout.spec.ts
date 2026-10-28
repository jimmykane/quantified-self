import { PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1, PLANNED_WORKOUT_PROVIDER_IDS, isPlannedWorkoutProviderDeliveryEnabled } from '@shared/planned-workout-providers';
import { isTrainingProviderDeliveryEnabled } from '@shared/training-delivery-rollout';

describe('Training delivery rollout', () => {
  it('describes completed Garmin strength proof and the unsupported Wahoo pool-length field', () => {
    const garminLimits = PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1.garmin.limits.join(' ');
    expect(garminLimits).toContain('account-side create/update/reschedule/withdrawal');
    expect(garminLimits).toContain('owner-confirmed Garmin Connect/watch evidence in #782');
    expect(garminLimits).toContain('not universal exercise/device support');
    expect(garminLimits).not.toMatch(/fixture\/emulator evidence only|proof remains in #782/);
    const wahooLimits = PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1.wahoo.limits.join(' ');
    expect(wahooLimits).toContain('no documented physical pool-length delivery field');
    expect(wahooLimits).toContain('QS does not support sending that setting');
    expect(wahooLimits).not.toContain('set it locally where needed');
  });

  it('enables admitted providers for every authenticated owner while COROS remains disabled globally', () => {
    for (const provider of PLANNED_WORKOUT_PROVIDER_IDS.filter(provider => provider !== 'coros')) {
      expect(isPlannedWorkoutProviderDeliveryEnabled(provider)).toBe(true);
      expect(isTrainingProviderDeliveryEnabled(provider, 'owner')).toBe(true);
      expect(isTrainingProviderDeliveryEnabled(provider, 'another-user')).toBe(true);
    }
    expect(isPlannedWorkoutProviderDeliveryEnabled('coros')).toBe(false);
    expect(isTrainingProviderDeliveryEnabled('coros', 'owner')).toBe(false);
    expect(isTrainingProviderDeliveryEnabled('coros', 'another-user')).toBe(false);
  });

  it.each([null, undefined, ''])('fails closed without an authenticated owner identity: %s', uid => {
    for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) expect(isTrainingProviderDeliveryEnabled(provider, uid)).toBe(false);
  });

  it.each(['another-user', ' owner', 'owner ', 'owner-other'])(
    'does not use an identity allowlist for authenticated identity %s', uid => {
      expect(isTrainingProviderDeliveryEnabled('coros', uid)).toBe(false);
      for (const provider of PLANNED_WORKOUT_PROVIDER_IDS.filter(provider => provider !== 'coros')) {
        expect(isTrainingProviderDeliveryEnabled(provider, uid)).toBe(true);
      }
    });
});
