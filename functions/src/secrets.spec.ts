import { describe, expect, it } from 'vitest';
import {
  ALL_SECRET_NAMES,
  FUNCTION_SECRET_BINDINGS,
  SECRET_PARAMS,
} from './secrets';
import {
  getExportedFirebaseFunctionNames,
  validateFunctionSecretBindings,
} from './secret-bindings-check';

const COROS = ['COROSAPI_CLIENT_ID', 'COROSAPI_CLIENT_SECRET'];
const GARMIN = ['GARMINAPI_CLIENT_ID', 'GARMINAPI_CLIENT_SECRET'];
const SUUNTO = ['SUUNTOAPP_CLIENT_ID', 'SUUNTOAPP_CLIENT_SECRET'];
const SUUNTO_API = [...SUUNTO, 'SUUNTOAPP_SUBSCRIPTION_KEY'];
const WAHOO = ['WAHOOAPI_CLIENT_ID', 'WAHOOAPI_CLIENT_SECRET'];

const EXPECTED_BINDINGS: Record<string, string[]> = {
  addCOROSAPIHistoryToQueue: COROS,
  addSuuntoAppHistoryToQueue: SUUNTO_API,
  addSuuntoAppRoutesToQueue: SUUNTO_API,
  addWahooAPIHistoryToQueue: WAHOO,
  assistantChat: ['GEMINI_API_KEY'],
  backfillCorosAPISleep: COROS,
  backfillGarminAPIActivities: GARMIN,
  backfillGarminAPIHealth: GARMIN,
  backfillSuuntoAppSleep: SUUNTO,
  cleanupStripeCustomer: ['STRIPE_SECRET_KEY'],
  cleanupUserAccounts: [...COROS, ...GARMIN, ...SUUNTO, ...WAHOO],
  deauthorizeCOROSAPI: COROS,
  deauthorizeGarminAPI: GARMIN,
  deauthorizeSuuntoApp: SUUNTO,
  deauthorizeWahooAPI: WAHOO,
  enforceSubscriptionLimits: [...COROS, ...GARMIN, ...SUUNTO, ...WAHOO, 'STRIPE_SECRET_KEY'],
  getCOROSAPIAuthRequestTokenRedirectURI: COROS,
  getCOROSAPIWorkoutFileUploadStatus: COROS,
  getFinancialStats: ['STRIPE_SECRET_KEY'],
  grantAdminSubscriptionGift: ['STRIPE_ADMIN_BILLING_KEY'],
  getGarminAPIAuthRequestTokenRedirectURI: GARMIN,
  getSuuntoAPIAuthRequestTokenRedirectURI: SUUNTO,
  getSuuntoFITFile: SUUNTO_API,
  getUpcomingRenewalAmount: ['STRIPE_SECRET_KEY'],
  getWahooAPIAuthRequestTokenRedirectURI: WAHOO,
  getWahooAPIWorkoutFileUploadStatus: WAHOO,
  importActivityToCOROSAPI: COROS,
  importActivityToSuuntoApp: SUUNTO_API,
  importActivityToWahooAPI: WAHOO,
  importRouteToCOROSAPI: COROS,
  importRouteToGarminAPI: GARMIN,
  importRouteToSuuntoApp: SUUNTO_API,
  importRouteToWahooAPI: WAHOO,
  insertCOROSAPIWorkoutDataToQueue: COROS,
  insertSuuntoAppActivityToQueue: [...SUUNTO, 'SUUNTOAPP_NOTIFICATION_SECRET'],
  insertSuuntoAppRouteToQueue: ['SUUNTOAPP_NOTIFICATION_SECRET'],
  linkExistingStripeCustomer: ['STRIPE_SECRET_KEY'],
  mcpApi: ['MAPBOX_ACCESS_TOKEN'],
  onSubscriptionUpdated: ['STRIPE_SECRET_KEY'],
  processActivitySyncTask: [...COROS, ...SUUNTO_API, ...WAHOO],
  processRouteDeliverySyncTask: [...COROS, ...SUUNTO_API, ...GARMIN, ...WAHOO],
  processRouteSyncTask: SUUNTO_API,
  processSleepSyncTask: [...COROS, ...GARMIN, ...SUUNTO_API],
  processGarminHealthBackfillTask: GARMIN,
  processWorkoutTask: [...COROS, ...GARMIN, ...SUUNTO_API, 'WAHOOAPI_ALLOWED_FILE_HOSTS'],
  previewAdminSubscriptionGift: ['STRIPE_ADMIN_BILLING_KEY'],
  receiveSuunto247Data: ['SUUNTOAPP_NOTIFICATION_SECRET'],
  refreshCOROSAPIRefreshTokens: COROS,
  refreshGarminAPIRefreshTokens: GARMIN,
  refreshSuuntoAppRefreshTokens: SUUNTO,
  requestAndSetCOROSAPIAccessToken: COROS,
  requestAndSetGarminAPIAccessToken: GARMIN,
  requestAndSetSuuntoAPIAccessToken: SUUNTO,
  requestAndSetWahooAPIAccessToken: WAHOO,
  restoreUserClaims: ['STRIPE_SECRET_KEY'],
  retryPendingServiceDisconnects: [...COROS, ...GARMIN, ...SUUNTO, ...WAHOO],
  scheduleSuuntoWebhookBindingVerification: SUUNTO,
  sendRoutesToService: [...COROS, ...SUUNTO_API, ...GARMIN, ...WAHOO],
  wahooAPIWebhook: ['WAHOOAPI_WEBHOOK_TOKEN'],
};

describe('Function Secret Manager policy', () => {
  it('registers the complete approved secret inventory', () => {
    expect([...ALL_SECRET_NAMES].sort()).toEqual([
      'COROSAPI_CLIENT_ID',
      'COROSAPI_CLIENT_SECRET',
      'GARMINAPI_CLIENT_ID',
      'GARMINAPI_CLIENT_SECRET',
      'GEMINI_API_KEY',
      'MAPBOX_ACCESS_TOKEN',
      'STRIPE_ADMIN_BILLING_KEY',
      'STRIPE_SECRET_KEY',
      'SUUNTOAPP_CLIENT_ID',
      'SUUNTOAPP_CLIENT_SECRET',
      'SUUNTOAPP_NOTIFICATION_SECRET',
      'SUUNTOAPP_SUBSCRIPTION_KEY',
      'WAHOOAPI_ALLOWED_FILE_HOSTS',
      'WAHOOAPI_CLIENT_ID',
      'WAHOOAPI_CLIENT_SECRET',
      'WAHOOAPI_WEBHOOK_TOKEN',
    ]);
  });

  it('keeps every secret-bound endpoint on the explicit least-privilege policy', () => {
    const actual = Object.fromEntries(Object.entries(FUNCTION_SECRET_BINDINGS).map(([functionName, secrets]) => [
      functionName,
      secrets.map(secret => secret.name),
    ]));

    expect(actual).toEqual(EXPECTED_BINDINGS);
  });

  it('contains no duplicate secret bindings for an endpoint', () => {
    for (const secrets of Object.values(FUNCTION_SECRET_BINDINGS)) {
      const names = secrets.map(secret => secret.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('accepts exact bindings and the implicit zero-secret default', () => {
    const violations = validateFunctionSecretBindings({
      boundFunction: {
        __endpoint: { secretEnvironmentVariables: [{ key: 'MAPBOX_ACCESS_TOKEN' }] },
      },
      publicFunction: {
        __endpoint: { secretEnvironmentVariables: [] },
      },
    }, {
      boundFunction: [SECRET_PARAMS.MAPBOX_ACCESS_TOKEN],
    });

    expect(violations).toEqual([]);
  });

  it('rejects missing, excessive, duplicate, and orphaned bindings', () => {
    const violations = validateFunctionSecretBindings({
      missingSecret: { __endpoint: { secretEnvironmentVariables: [] } },
      excessiveSecret: {
        __endpoint: { secretEnvironmentVariables: [{ key: 'GEMINI_API_KEY' }] },
      },
      duplicateSecret: {
        __endpoint: {
          secretEnvironmentVariables: [
            { key: 'MAPBOX_ACCESS_TOKEN' },
            { key: 'MAPBOX_ACCESS_TOKEN' },
          ],
        },
      },
    }, {
      missingSecret: [SECRET_PARAMS.MAPBOX_ACCESS_TOKEN],
      duplicateSecret: [SECRET_PARAMS.MAPBOX_ACCESS_TOKEN],
      orphanedPolicyEntry: [SECRET_PARAMS.STRIPE_SECRET_KEY],
    });

    expect(violations).toEqual(expect.arrayContaining([
      expect.stringContaining('missingSecret'),
      expect.stringContaining('excessiveSecret'),
      expect.stringContaining('duplicateSecret'),
      expect.stringContaining('orphanedPolicyEntry'),
    ]));
  });

  it('discovers only exported Firebase endpoints', () => {
    expect(getExportedFirebaseFunctionNames({
      helper: () => undefined,
      secondFunction: { __endpoint: {} },
      firstFunction: { __endpoint: {} },
    })).toEqual(['firstFunction', 'secondFunction']);
  });
});
