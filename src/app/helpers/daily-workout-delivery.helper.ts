import { ServiceNames } from '@sports-alliance/sports-lib';
import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from '@shared/planned-workout-providers';

/** A private UI preference, separate from generation context and per-workout delivery consent. */
export interface DailyWorkoutDeliveryPreferences {
  enabled: boolean;
  providers: PlannedWorkoutProviderId[];
}

export const DAILY_WORKOUT_DELIVERY_SERVICES = {
  garmin: ServiceNames.GarminAPI, coros: ServiceNames.COROSAPI,
  wahoo: ServiceNames.WahooAPI, suunto: ServiceNames.SuuntoApp,
} satisfies Record<PlannedWorkoutProviderId, ServiceNames>;

export function parseDailyWorkoutDeliveryPreferences(value: unknown): DailyWorkoutDeliveryPreferences {
  if (value === undefined) return { enabled: false, providers: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid daily delivery preferences.');
  const input = value as Record<string, unknown>;
  const providers = input.providers;
  if (Object.keys(input).some(key => !['enabled', 'providers'].includes(key)) || typeof input.enabled !== 'boolean'
    || !Array.isArray(providers) || providers.length > PLANNED_WORKOUT_PROVIDER_IDS.length
    || new Set(providers).size !== providers.length
    || providers.some(provider => !PLANNED_WORKOUT_PROVIDER_IDS.includes(provider))
    || input.enabled && providers.length === 0) throw Error('Choose at least one supported delivery service.');
  return { enabled: input.enabled, providers: PLANNED_WORKOUT_PROVIDER_IDS.filter(provider => providers.includes(provider)) };
}

export function dailyWorkoutDeliveryPreferences(value: unknown): DailyWorkoutDeliveryPreferences {
  try { return parseDailyWorkoutDeliveryPreferences(value); }
  catch { return { enabled: false, providers: [] }; }
}
