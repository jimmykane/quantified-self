import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import { hashTrainingScheduleRequestPayload } from '../persistence';
import { serializeGarminWorkoutV1 } from '../providers/garmin-workout.serializer';
import { serializeCorosTrainingPlanV1 } from '../providers/coros-training-plan.serializer';
import { serializeWahooPlanJsonV1 } from '../providers/wahoo-plan.serializer';
import { serializeSuuntoGuideJsonV1 } from '../providers/suunto-guide.serializer';
import { ProviderWorkoutMappingError } from '../providers/provider-mapping';
import type { DeliveryAssessment } from './contracts';

export const TRAINING_DELIVERY_MAPPING_VERSION = 'fixtures-v1';
/** Fixture assessment is available without provider access; serialization is NOT delivery. */
export function assessTrainingDeliveryMapping(provider: PlannedWorkoutProviderId, workout: ScheduledWorkoutV1,
  destinationKey: string, timeZone: string): DeliveryAssessment {
  const digest = hashTrainingScheduleRequestPayload({ provider, destinationKey, timeZone,
    mappingVersion: TRAINING_DELIVERY_MAPPING_VERSION, title: workout.title, localDate: workout.localDate, structure: workout.structure });
  try {
    const options = { name: workout.title, allowDegraded: true };
    const result = provider === 'garmin' ? serializeGarminWorkoutV1(workout.structure, options)
      : provider === 'coros' ? serializeCorosTrainingPlanV1(workout.structure, {
        athleteId: 1, sourceWorkoutId: destinationKey, title: workout.title, localDate: workout.localDate,
        lastModifiedDate: `${workout.localDate}T00:00:00`, allowDegraded: true,
      }) : provider === 'wahoo' ? serializeWahooPlanJsonV1(workout.structure, { ...options, location: 'outdoor' })
        : serializeSuuntoGuideJsonV1(workout.structure, { ...options, owner: 'Quantified Self',
          url: 'https://quantified-self.io', localDate: workout.localDate, sourceWorkoutId: destinationKey });
    return { level: result.level, issues: result.issues.map(issue => issue.message).slice(0, 20), digest, mappingVersion: TRAINING_DELIVERY_MAPPING_VERSION };
  } catch (error) {
    if (!(error instanceof ProviderWorkoutMappingError)) throw error;
    return { level: 'unsupported', issues: error.issues.map(issue => issue.message).slice(0, 20), digest, mappingVersion: TRAINING_DELIVERY_MAPPING_VERSION };
  }
}
