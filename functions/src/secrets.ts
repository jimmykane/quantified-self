import { defineSecret, type SecretParam } from 'firebase-functions/params';

/**
 * Canonical Secret Manager parameters used by deployed Functions.
 *
 * Keep this inventory and FUNCTION_SECRET_BINDINGS exhaustive. Secret values
 * must only be read while a bound Function invocation is running.
 */
export const SECRET_PARAMS = {
  COROSAPI_CLIENT_ID: defineSecret('COROSAPI_CLIENT_ID'),
  COROSAPI_CLIENT_SECRET: defineSecret('COROSAPI_CLIENT_SECRET'),
  GARMINAPI_CLIENT_ID: defineSecret('GARMINAPI_CLIENT_ID'),
  GARMINAPI_CLIENT_SECRET: defineSecret('GARMINAPI_CLIENT_SECRET'),
  GEMINI_API_KEY: defineSecret('GEMINI_API_KEY'),
  MAPBOX_ACCESS_TOKEN: defineSecret('MAPBOX_ACCESS_TOKEN'),
  STRIPE_ADMIN_BILLING_KEY: defineSecret('STRIPE_ADMIN_BILLING_KEY'),
  STRIPE_SECRET_KEY: defineSecret('STRIPE_SECRET_KEY'),
  SUUNTOAPP_CLIENT_ID: defineSecret('SUUNTOAPP_CLIENT_ID'),
  SUUNTOAPP_CLIENT_SECRET: defineSecret('SUUNTOAPP_CLIENT_SECRET'),
  SUUNTOAPP_NOTIFICATION_SECRET: defineSecret('SUUNTOAPP_NOTIFICATION_SECRET'),
  SUUNTOAPP_SUBSCRIPTION_KEY: defineSecret('SUUNTOAPP_SUBSCRIPTION_KEY'),
  WAHOOAPI_ALLOWED_FILE_HOSTS: defineSecret('WAHOOAPI_ALLOWED_FILE_HOSTS'),
  WAHOOAPI_CLIENT_ID: defineSecret('WAHOOAPI_CLIENT_ID'),
  WAHOOAPI_CLIENT_SECRET: defineSecret('WAHOOAPI_CLIENT_SECRET'),
  WAHOOAPI_WEBHOOK_TOKEN: defineSecret('WAHOOAPI_WEBHOOK_TOKEN'),
} as const;

export const ALL_SECRET_NAMES = Object.freeze(Object.keys(SECRET_PARAMS)) as readonly (keyof typeof SECRET_PARAMS)[];

const COROS: SecretParam[] = [
  SECRET_PARAMS.COROSAPI_CLIENT_ID,
  SECRET_PARAMS.COROSAPI_CLIENT_SECRET,
];
const GARMIN: SecretParam[] = [
  SECRET_PARAMS.GARMINAPI_CLIENT_ID,
  SECRET_PARAMS.GARMINAPI_CLIENT_SECRET,
];
const SUUNTO: SecretParam[] = [
  SECRET_PARAMS.SUUNTOAPP_CLIENT_ID,
  SECRET_PARAMS.SUUNTOAPP_CLIENT_SECRET,
];
const SUUNTO_API: SecretParam[] = [
  ...SUUNTO,
  SECRET_PARAMS.SUUNTOAPP_SUBSCRIPTION_KEY,
];
const WAHOO: SecretParam[] = [
  SECRET_PARAMS.WAHOOAPI_CLIENT_ID,
  SECRET_PARAMS.WAHOOAPI_CLIENT_SECRET,
];

/**
 * Least-privilege deployment policy. Any exported Function absent from this
 * map must have no Secret Manager bindings; the compiled checker enforces that
 * zero-binding default as well as every non-empty entry below.
 */
export const FUNCTION_SECRET_BINDINGS = {
  addCOROSAPIHistoryToQueue: COROS,
  addSuuntoAppHistoryToQueue: SUUNTO_API,
  addSuuntoAppRoutesToQueue: SUUNTO_API,
  addWahooAPIHistoryToQueue: WAHOO,
  assistantChat: [SECRET_PARAMS.GEMINI_API_KEY],
  backfillCorosAPISleep: COROS,
  backfillGarminAPIActivities: GARMIN,
  backfillGarminAPIHealth: GARMIN,
  backfillSuuntoAppSleep: SUUNTO,
  cleanupStripeCustomer: [SECRET_PARAMS.STRIPE_SECRET_KEY],
  cleanupUserAccounts: [...COROS, ...GARMIN, ...SUUNTO, ...WAHOO],
  deauthorizeCOROSAPI: COROS,
  deauthorizeGarminAPI: GARMIN,
  deauthorizeSuuntoApp: SUUNTO,
  deauthorizeWahooAPI: WAHOO,
  enforceSubscriptionLimits: [...COROS, ...GARMIN, ...SUUNTO, ...WAHOO, SECRET_PARAMS.STRIPE_SECRET_KEY],
  getCOROSAPIAuthRequestTokenRedirectURI: COROS,
  getCOROSAPIWorkoutFileUploadStatus: COROS,
  getFinancialStats: [SECRET_PARAMS.STRIPE_SECRET_KEY],
  grantAdminSubscriptionGift: [SECRET_PARAMS.STRIPE_ADMIN_BILLING_KEY],
  getGarminAPIAuthRequestTokenRedirectURI: GARMIN,
  getSuuntoAPIAuthRequestTokenRedirectURI: SUUNTO,
  getSuuntoFITFile: SUUNTO_API,
  getUpcomingRenewalAmount: [SECRET_PARAMS.STRIPE_SECRET_KEY],
  getWahooAPIAuthRequestTokenRedirectURI: WAHOO,
  getWahooAPIWorkoutFileUploadStatus: WAHOO,
  importActivityToCOROSAPI: COROS,
  importActivityToSuuntoApp: SUUNTO_API,
  importActivityToWahooAPI: WAHOO,
  importRouteToGarminAPI: GARMIN,
  importRouteToCOROSAPI: COROS,
  importRouteToSuuntoApp: SUUNTO_API,
  importRouteToWahooAPI: WAHOO,
  insertCOROSAPIWorkoutDataToQueue: COROS,
  insertSuuntoAppActivityToQueue: [...SUUNTO, SECRET_PARAMS.SUUNTOAPP_NOTIFICATION_SECRET],
  insertSuuntoAppRouteToQueue: [SECRET_PARAMS.SUUNTOAPP_NOTIFICATION_SECRET],
  linkExistingStripeCustomer: [SECRET_PARAMS.STRIPE_SECRET_KEY],
  mcpApi: [SECRET_PARAMS.MAPBOX_ACCESS_TOKEN],
  onSubscriptionUpdated: [SECRET_PARAMS.STRIPE_SECRET_KEY],
  processActivitySyncTask: [...COROS, ...SUUNTO_API, ...WAHOO],
  processRouteDeliverySyncTask: [...COROS, ...SUUNTO_API, ...GARMIN, ...WAHOO],
  processRouteSyncTask: SUUNTO_API,
  processSleepSyncTask: [...COROS, ...GARMIN, ...SUUNTO_API],
  processGarminHealthBackfillTask: GARMIN,
  processWorkoutTask: [...COROS, ...GARMIN, ...SUUNTO_API, SECRET_PARAMS.WAHOOAPI_ALLOWED_FILE_HOSTS],
  previewAdminSubscriptionGift: [SECRET_PARAMS.STRIPE_ADMIN_BILLING_KEY],
  receiveSuunto247Data: [SECRET_PARAMS.SUUNTOAPP_NOTIFICATION_SECRET],
  refreshCOROSAPIRefreshTokens: COROS,
  refreshGarminAPIRefreshTokens: GARMIN,
  refreshSuuntoAppRefreshTokens: SUUNTO,
  requestAndSetCOROSAPIAccessToken: COROS,
  requestAndSetGarminAPIAccessToken: GARMIN,
  requestAndSetSuuntoAPIAccessToken: SUUNTO,
  requestAndSetWahooAPIAccessToken: WAHOO,
  restoreUserClaims: [SECRET_PARAMS.STRIPE_SECRET_KEY],
  retryPendingServiceDisconnects: [...COROS, ...GARMIN, ...SUUNTO, ...WAHOO],
  sendRoutesToService: [...COROS, ...SUUNTO_API, ...GARMIN, ...WAHOO],
  wahooAPIWebhook: [SECRET_PARAMS.WAHOOAPI_WEBHOOK_TOKEN],
} satisfies Record<string, SecretParam[]>;

export type SecretBoundFunctionName = keyof typeof FUNCTION_SECRET_BINDINGS;
