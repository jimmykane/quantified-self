import { describe, expect, it, vi } from 'vitest';
import {
  loadFunctionTarget,
  OPTIMIZED_FUNCTION_TARGETS,
  resolveRuntimeFunctionTarget,
} from './function-target-loader';

describe('function target loader', () => {
  it('optimizes account deletion, MCP, ingestion, maintenance, provider connection/webhook, admin, marketing, and Training endpoints', () => {
    expect(OPTIMIZED_FUNCTION_TARGETS).toEqual([
      'cleanupUserAccountsV2',
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
      'onDashboardDerivedMetricsActivityWrite',
      'onDashboardDerivedMetricsEventWrite',
      'onDashboardDerivedMetricsSleepWrite',
      'onDashboardDerivedMetricsHealthWrite',
      'processDerivedMetricsTask',
      'processDerivedMetricsIngressTask',
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
