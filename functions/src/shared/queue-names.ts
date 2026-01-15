import { ServiceNames } from '@sports-alliance/sports-lib';
import { SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME } from '../coros/constants';
import { GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME } from '../garmin/constants';

export function getServiceWorkoutQueueName(serviceName: ServiceNames): string {
    switch (serviceName) {
        default:
            throw new Error(`Workout queue not implemented for ${serviceName}`);
        case ServiceNames.GarminAPI:
            return GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME;
        case ServiceNames.SuuntoApp:
            return SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME;
        case ServiceNames.COROSAPI:
            return COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME;
    }
}
