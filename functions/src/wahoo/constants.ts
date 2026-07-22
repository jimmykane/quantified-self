import { ServiceNames } from '@sports-alliance/sports-lib';

export const WAHOO_API_BASE_URL = 'https://api.wahooligan.com';
export const WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME = 'wahooAPIAccessTokens';
export const WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME = 'wahooAPIWorkoutQueue';
export const WAHOO_API_USER_MAPPINGS_COLLECTION_NAME = 'wahooAPIUserMappings';
export const WAHOO_API_SCOPES = 'user_read workouts_read workouts_write routes_read routes_write offline_data';
export const WAHOO_API_WORKOUTS_WRITE_SCOPE = 'workouts_write';
export const WAHOO_API_ROUTES_READ_SCOPE = 'routes_read';
export const WAHOO_API_ROUTES_WRITE_SCOPE = 'routes_write';
export const WAHOO_API_REQUEST_TIMEOUT_MS = 30_000;
export const WAHOO_FIT_DOWNLOAD_TIMEOUT_MS = 60_000;
export const SERVICE_NAME = ServiceNames.WahooAPI;
