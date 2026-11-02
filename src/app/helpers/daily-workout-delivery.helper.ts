import { ServiceNames } from '@sports-alliance/sports-lib';
import { type PlannedWorkoutProviderId } from '@shared/planned-workout-providers';

export { dailyWorkoutDeliveryPreferences, parseDailyWorkoutDeliveryPreferences, type DailyWorkoutDeliveryPreferences } from '@shared/daily-workout-delivery';

export const DAILY_WORKOUT_DELIVERY_SERVICES = {
  garmin: ServiceNames.GarminAPI, coros: ServiceNames.COROSAPI,
  wahoo: ServiceNames.WahooAPI, suunto: ServiceNames.SuuntoApp,
} satisfies Record<PlannedWorkoutProviderId, ServiceNames>;
