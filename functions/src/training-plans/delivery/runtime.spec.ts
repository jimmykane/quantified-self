import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, vi } from 'vitest';
import { PLANNED_WORKOUT_PROVIDER_IDS } from '../../../../shared/planned-workout-providers';
import { productionDeliveryRuntime } from './runtime';

describe('Production Training delivery rollout', () => {
  const runtime = productionDeliveryRuntime({} as Firestore);
  afterEach(() => vi.unstubAllEnvs());
  it('binds Suunto only with the exact owner name, without reading credentials or making requests', () => {
    vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', 'Quantified Self');
    const transport = runtime.transport('suunto', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2');
    expect(transport).toMatchObject({ horizonDays: 6, withdrawOutsideHorizon: true });
    expect(transport?.inspection?.policy).toMatchObject({ authoritativeAbsence: false, repairReady: false });
    expect(runtime.transport('suunto', 'other')).toBeNull();
    vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', '');
    expect(runtime.transport('suunto', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2')).toBeNull();
  });

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
