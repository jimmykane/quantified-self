import { ServiceNames } from '@sports-alliance/sports-lib';
import { SUUNTOAPP_HISTORY_IMPORT_WORKOUT_QUEUE_COLLECTION_NAME, SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_HISTORY_IMPORT_WORKOUT_QUEUE_COLLECTION_NAME, COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME } from '../coros/constants';
import { GARMIN_HEALTHAPI_WORKOUT_QUEUE_COLLECTION_NAME } from '../garmin/constants';

export function getServiceHistoryImportWorkoutQueueName(serviceName: ServiceNames): string {
    switch (serviceName) {
        default:
            throw new Error(`History import not implemented for ${serviceName}`);
        case ServiceNames.SuuntoApp:
            return SUUNTOAPP_HISTORY_IMPORT_WORKOUT_QUEUE_COLLECTION_NAME;
        case ServiceNames.COROSAPI:
            return COROSAPI_HISTORY_IMPORT_WORKOUT_QUEUE_COLLECTION_NAME;
    }
}

export function getServiceWorkoutQueueName(serviceName: ServiceNames, historyQueue = false): string {
    if (historyQueue) {
        return getServiceHistoryImportWorkoutQueueName(serviceName);
    }
    switch (serviceName) {
        default:
            throw new Error(`Workout queue not implemented for ${serviceName}`);
        case ServiceNames.GarminHealthAPI:
            return GARMIN_HEALTHAPI_WORKOUT_QUEUE_COLLECTION_NAME;
        case ServiceNames.SuuntoApp:
            return SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME;
        case ServiceNames.COROSAPI:
            return COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME;
    }
}
