import { ServiceNames } from '@sports-alliance/sports-lib';

export const STAGING_URL = 'https://opentest.coros.com';
export const PRODUCTION_URL = 'https://open.coros.com';
export const COROSAPI_ACCESS_TOKENS_COLLECTION_NAME = 'COROSAPIAccessTokens';
export const COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME = 'COROSAPIWorkoutQueue';
export const SERVICE_NAME = ServiceNames.COROSAPI;
export const USE_STAGING = false;
export const COROS_TOKEN_REFRESH_THRESHOLD_DAYS = 20;
export const COROS_ACCESS_TOKEN_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;
export const COROS_ACCESS_TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
export const COROS_API_REQUEST_TIMEOUT_MS = 30_000;
export const COROS_FIT_DOWNLOAD_TIMEOUT_MS = 60_000;
export const COROS_FIT_DOWNLOAD_ALLOWED_HOSTS = ['oss.coros.com'] as const;
export const COROS_FIT_DOWNLOAD_ALLOWED_HOST_SUFFIXES = ['.cloudfront.net'] as const;
