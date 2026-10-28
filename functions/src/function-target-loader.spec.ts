import { describe, expect, it, vi } from 'vitest';
import {
  loadFunctionTarget,
  OPTIMIZED_FUNCTION_TARGETS,
  resolveRuntimeFunctionTarget,
} from './function-target-loader';

describe('function target loader', () => {
  it('resolves the dotted Firebase compatibility runtime target', () => {
    expect(resolveRuntimeFunctionTarget({ FUNCTION_TARGET: 'ext.firestore.stripe.payments.createPortalLink' })).toBe('ext-firestore-stripe-payments-createPortalLink');
  });
  it('registers an isolated loader for every deployed function', () => {
    expect(OPTIMIZED_FUNCTION_TARGETS).toEqual([
      'linkExistingStripeCustomer',
      'restoreUserClaims',
      'getUpcomingRenewalAmount',
      'onSubscriptionUpdated',
      'enforceSubscriptionLimits',
      'checkSubscriptionNotifications',
      'cleanupStripeCustomer',
      'cleanupUserAccounts',
      'createStripeCheckoutSession',
      'createStripePortalLink',
      'ext-firestore-stripe-payments-createPortalLink',
      'stripeBillingWebhook',
      'dispatchStripeBillingJob',
      'recoverStripeBillingJobs',
      'processStripeBillingTask',
      'deleteStripeCustomerOnDocumentDeleted',
      'mcpApi',
      'getSuuntoAPIAuthRequestTokenRedirectURI',
      'requestAndSetSuuntoAPIAccessToken',
      'receiveSuunto247Data',
      'receiveGarminAPIHealthData',
      'projectSuuntoConnectionOnTokenWrite',
      'projectGarminConnectionOnTokenWrite',
      'processSleepSyncTask',
      'processGarminHealthBackfillTask',
      'dispatchSleepSyncQueue',
      'processWorkoutTask',
      'processSportsLibReparseTask',
      'processSportsLibReparseHeavyTask',
      'processSportsLibRouteReparseTask',
      'scheduleSportsLibReparseScan',
      'scheduleSportsLibRouteReparseScan',
      'parseGarminAPIActivityQueue',
      'parseSuuntoAppActivityQueue',
      'parseCOROSAPIWorkoutQueue',
      'parseWahooAPIWorkoutQueue',
      'processActivitySyncTask',
      'dispatchActivitySyncQueue',
      'processRouteSyncTask',
      'processRouteDeliverySyncTask',
      'dispatchRouteDeliverySyncQueue',
      'cleanupRejectedRouteOriginalFile',
      'cleanupEventFile',
      'activitySendCommand',
      'uploadActivitySendFile',
      'admitActivitySend',
      'projectActivitySendDelivery',
      'cleanupActivitySends',
      'cleanupActivitySendOnDelete',
      'uploadActivity',
      'fanOutSuuntoHealthWebhookIngress',
      'dispatchGarminPingBatchOnWrite',
      'scheduleSuuntoHealthSync',
      'scheduleSuuntoSleepSync',
      'redriveRejectedRouteOriginalCleanup',
      'retryPendingServiceDisconnects',
      'listUsers',
      'getUserCount',
      'getQueueStats',
      'retrySportsLibReparseHeavyJob',
      'setSportsLibReparseSettings',
      'getAdminDashboardHistory',
      'scheduleAdminDashboardSnapshot',
      'getSubscriptionHistoryTrend',
      'getUserGrowthTrend',
      'setMaintenanceMode',
      'getMaintenanceStatus',
      'impersonateUser',
      'stopImpersonation',
      'getFinancialStats',
      'previewAdminSubscriptionGift',
      'grantAdminSubscriptionGift',
      'listMarketingCampaigns',
      'saveMarketingCampaign',
      'cloneMarketingCampaign',
      'previewMarketingCampaign',
      'prepareMarketingCampaign',
      'setMarketingDailyCap',
      'sendMarketingTest',
      'changeMarketingCampaignStatus',
      'dispatchMarketingCampaigns',
      'trackMarketingDelivery',
      'marketingUnsubscribe',
      'processConnectionHistoryTask',
      'onConnectionHistoryImportWritten',
      'recoverConnectionHistoryImports',
      'retryConnectionHistoryImport',
      'reconcileTrainingPlanCleanup',
      'reconcileTrainingWorkoutExpiry',
      'reconcileTrainingBulkShift',
      'applyAssistantTrainingProposal',
      'ensureDerivedMetrics',
      'setTrainingBuildBenchmark',
      'mutateTrainingSchedule',
      'mutateWorkoutLibrary',
      'placeWorkoutLibrary',
      'getTrainingScheduleHistory',
      'previewTrainingScheduleRestore',
      'restoreTrainingScheduleRevision',
      'deleteTrainingPlan',
      'previewTrainingProviderDelivery',
      'mutateTrainingProviderDelivery',
      'processTrainingDeliveryTask',
      'onTrainingDeliveryQueued',
      'dispatchTrainingDelivery',
      'onTrainingDeliveryConnectionChanged',
      'onTrainingDeliveryEntitlementChanged',
      'onTrainingDeliveryGuideSettingsChanged',
      'onDashboardDerivedMetricsActivityWrite',
      'onDashboardDerivedMetricsEventWrite',
      'onDashboardDerivedMetricsSleepWrite',
      'onTrainingLoadMetadataWrite',
      'onDashboardDerivedMetricsHealthWrite',
      'processDerivedMetricsTask',
      'processDerivedMetricsIngressTask',
      'observeDerivedMetricsHealth',
      'addCOROSAPIHistoryToQueue',
      'addSuuntoAppHistoryToQueue',
      'addSuuntoAppRoutesToQueue',
      'addWahooAPIHistoryToQueue',
      'generateDayWorkout',
      'assistantChat',
      'backfillActivitySyncRoute',
      'backfillCorosAPISleep',
      'backfillGarminAPIActivities',
      'backfillGarminAPIHealth',
      'backfillRouteDeliverySyncRoute',
      'backfillSuuntoAppSleep',
      'cleanupRouteFiles',
      'createToolComparisonEvent',
      'deauthorizeCOROSAPI',
      'deauthorizeGarminAPI',
      'deauthorizeGarminAPIUsers',
      'deauthorizeSuuntoApp',
      'deauthorizeWahooAPI',
      'decideMcpAuthorization',
      'deleteManualHealthMeasurement',
      'deleteSelf',
      'deleteTimelineNote',
      'disableActivitySyncRoutesOnCOROSTokenRootDelete',
      'disableActivitySyncRoutesOnGarminTokenRootDelete',
      'disableActivitySyncRoutesOnSuuntoTokenRootDelete',
      'disableActivitySyncRoutesOnWahooTokenRootDelete',
      'getAssistantConversation',
      'getAssistantQuotaStatus',
      'getCOROSAPIAuthRequestTokenRedirectURI',
      'getCOROSAPIBindingState',
      'getCOROSAPIWorkoutFileUploadStatus',
      'getGarminAPIAuthRequestTokenRedirectURI',
      'getGarminHealthSyncAvailability',
      'getMcpAuthorizationRequest',
      'getSuuntoHealthSyncAvailability',
      'getWahooAPIAuthRequestTokenRedirectURI',
      'getWahooAPIConnectionAccount',
      'getWahooAPIWorkoutFileUploadStatus',
      'importActivityToCOROSAPI',
      'importActivityToSuuntoApp',
      'importActivityToWahooAPI',
      'importRouteToCOROSAPI',
      'importRouteToGarminAPI',
      'importRouteToSuuntoApp',
      'importRouteToWahooAPI',
      'insertCOROSAPIWorkoutDataToQueue',
      'insertGarminAPIActivityFileToQueue',
      'insertSuuntoAppActivityToQueue',
      'insertSuuntoAppRouteToQueue',
      'listMcpConnections',
      'mergeEvents',
      'projectCOROSConnectionOnTokenWrite',
      'queryActivityHealthRange',
      'queryHealthRange',
      'receiveGarminAPIUserPermissions',
      'refreshCOROSAPIRefreshTokens',
      'refreshGarminAPIRefreshTokens',
      'refreshSuuntoAppRefreshTokens',
      'reprocessEvent',
      'reprocessRoute',
      'requestAndSetCOROSAPIAccessToken',
      'requestAndSetGarminAPIAccessToken',
      'requestAndSetWahooAPIAccessToken',
      'resetAssistantConversation',
      'revokeMcpConnection',
      'saveManualHealthMeasurement',
      'saveTimelineNote',
      'scheduleCOROSSleepSync',
      'sendRegistrationWelcomeEmail',
      'sendRoutesToService',
      'setEventSharing',
      'uploadRoute',
      'wahooAPIWebhook',
    ]);
  });

  it('resolves a trimmed target only during runtime loading', () => {
    expect(resolveRuntimeFunctionTarget({ FUNCTION_TARGET: '  suuntoTarget  ' }))
      .toBe('suuntoTarget');
    expect(resolveRuntimeFunctionTarget({ FUNCTION_TARGET: '   ' })).toBeUndefined();
  });

  it.each([
    { FUNCTIONS_CONTROL_API: 'true' },
    { FUNCTIONS_MANIFEST_OUTPUT_PATH: '/tmp/functions.yaml' },
  ])('ignores an inherited target during Firebase discovery: %o', discoveryEnvironment => {
    expect(resolveRuntimeFunctionTarget({
      FUNCTION_TARGET: 'getSuuntoAPIAuthRequestTokenRedirectURI',
      ...discoveryEnvironment,
    })).toBeUndefined();
  });

  it.each(['gcfv1', 'gcfv2'])('returns the original %s function object', platform => {
    const handler = { __trigger: { platform } };
    const loader = vi.fn(() => ({ suuntoTarget: handler }));

    expect(loadFunctionTarget('suuntoTarget', { suuntoTarget: loader })).toBe(handler);
    expect(loader).toHaveBeenCalledOnce();
  });

  it('does not load a module for an unknown target', () => {
    const loader = vi.fn(() => ({ suuntoTarget: {} }));

    expect(loadFunctionTarget('otherTarget', { suuntoTarget: loader })).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
  });

  it('treats inherited object properties as unknown targets', () => {
    const loader = vi.fn(() => ({ suuntoTarget: {} }));

    expect(loadFunctionTarget('toString', { suuntoTarget: loader })).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
  });

  it('fails when the configured module does not export its target', () => {
    expect(() => loadFunctionTarget('suuntoTarget', {
      suuntoTarget: () => ({}),
    })).toThrow('Function target "suuntoTarget" was not exported by its configured module.');
  });
});
