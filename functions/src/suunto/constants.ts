import { ServiceNames } from '@sports-alliance/sports-lib';

export const SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME = 'suuntoAppAccessTokens';
export const SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME = 'suuntoAppWorkoutQueue';
export const SERVICE_NAME = ServiceNames.SuuntoApp;
export const SUUNTO_TOKEN_REFRESH_THRESHOLD_DAYS = 90;
export const SUUNTO_SUSPICIOUS_EMPTY_FIT_MAX_BYTES = 512;
export const SUUNTO_FIT_DOWNLOAD_TIMEOUT_MS = 60_000;
// QS download safety bound, not a claimed Suunto API file-size guarantee.
export const SUUNTO_FIT_MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
export const SUUNTO_FIT_DOWNLOAD_TOO_LARGE_CONTEXT = 'SUUNTO_ACTIVITY_FILE_TOO_LARGE';
