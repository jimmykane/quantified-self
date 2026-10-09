type FunctionModule = Record<string, unknown>;
type ModuleLoader = () => FunctionModule;

const loadMarketingHandlers = (): FunctionModule =>
  module.require('./admin/marketing/handlers') as FunctionModule;
const loadAdminUsersHandlers = (): FunctionModule =>
  module.require('./admin/handlers/users.handlers') as FunctionModule;
const loadAdminQueuesHandlers = (): FunctionModule =>
  module.require('./admin/handlers/queues.handlers') as FunctionModule;
const loadAdminDashboardHistoryHandlers = (): FunctionModule =>
  module.require('./admin/handlers/dashboard-history.handlers') as FunctionModule;
const loadAdminTrendsHandlers = (): FunctionModule =>
  module.require('./admin/handlers/trends.handlers') as FunctionModule;
const loadAdminMaintenanceHandlers = (): FunctionModule =>
  module.require('./admin/handlers/maintenance.handlers') as FunctionModule;
const loadAdminImpersonationHandlers = (): FunctionModule =>
  module.require('./admin/handlers/impersonation.handlers') as FunctionModule;
const loadAdminSubscriptionGiftHandlers = (): FunctionModule =>
  module.require('./admin/handlers/subscription-gifts.handlers') as FunctionModule;
const loadTrainingScheduleHistory = (): FunctionModule =>
  module.require('./training-plans/history-callables') as FunctionModule;
const loadTrainingDeliveryCommands = (): FunctionModule =>
  module.require('./training-plans/delivery/commands') as FunctionModule;
const loadTrainingDeliveryTasks = (): FunctionModule =>
  module.require('./training-plans/delivery/tasks') as FunctionModule;
const loadTrainingDeliveryLifecycle = (): FunctionModule =>
  module.require('./training-plans/delivery/lifecycle') as FunctionModule;
const loadDashboardDerivedMetricsTriggers = (): FunctionModule =>
  module.require('./derived-metrics/derived-metrics.trigger') as FunctionModule;
const loadSleepPolling = (): FunctionModule =>
  module.require('./sleep/polling') as FunctionModule;
const loadServiceConnectionAccountProjection = (): FunctionModule =>
  module.require('./service-connection-account-projection') as FunctionModule;
const loadActivityImportDispatchers = (): FunctionModule =>
  module.require('./queue') as FunctionModule;

const TARGET_LOADERS: Readonly<Record<string, ModuleLoader>> = Object.freeze({
  mcpApi: () => module.require('./mcp/server') as FunctionModule,
  getSuuntoAPIAuthRequestTokenRedirectURI:
    () => module.require('./suunto/auth/wrapper') as FunctionModule,
  requestAndSetSuuntoAPIAccessToken:
    () => module.require('./suunto/auth/wrapper') as FunctionModule,
  receiveSuunto247Data:
    () => module.require('./sleep/webhooks') as FunctionModule,
  receiveGarminAPIHealthData:
    () => module.require('./sleep/webhooks') as FunctionModule,
  projectSuuntoConnectionOnTokenWrite: loadServiceConnectionAccountProjection,
  projectGarminConnectionOnTokenWrite: loadServiceConnectionAccountProjection,
  processSleepSyncTask:
    () => module.require('./tasks/sleep-sync-worker') as FunctionModule,
  processGarminHealthBackfillTask:
    () => module.require('./tasks/garmin-health-backfill-worker') as FunctionModule,
  dispatchSleepSyncQueue:
    () => module.require('./sleep/dispatcher') as FunctionModule,
  processWorkoutTask:
    () => module.require('./tasks/workout-processor') as FunctionModule,
  parseGarminAPIActivityQueue: loadActivityImportDispatchers,
  parseSuuntoAppActivityQueue: loadActivityImportDispatchers,
  parseCOROSAPIWorkoutQueue: loadActivityImportDispatchers,
  parseWahooAPIWorkoutQueue: loadActivityImportDispatchers,
  processActivitySyncTask:
    () => module.require('./tasks/activity-sync-worker') as FunctionModule,
  dispatchActivitySyncQueue:
    () => module.require('./activity-sync/dispatcher') as FunctionModule,
  processRouteSyncTask:
    () => module.require('./tasks/route-sync-worker') as FunctionModule,
  processRouteDeliverySyncTask:
    () => module.require('./tasks/route-delivery-sync-worker') as FunctionModule,
  dispatchRouteDeliverySyncQueue:
    () => module.require('./route-delivery-sync/dispatcher') as FunctionModule,
  cleanupRejectedRouteOriginalFile:
    () => module.require('./routes/rejected-original-cleanup') as FunctionModule,
  cleanupEventFile:
    () => module.require('./events/cleanup') as FunctionModule,
  uploadActivity:
    () => module.require('./events/upload-activity') as FunctionModule,
  fanOutSuuntoHealthWebhookIngress:
    () => module.require('./suunto/health-webhook-ingress') as FunctionModule,
  dispatchGarminPingBatchOnWrite:
    () => module.require('./sleep/garmin-ping-batch-dispatcher') as FunctionModule,
  scheduleSuuntoHealthSync: loadSleepPolling,
  scheduleSuuntoSleepSync: loadSleepPolling,
  redriveRejectedRouteOriginalCleanup:
    () => module.require('./routes/rejected-original-cleanup') as FunctionModule,
  retryPendingServiceDisconnects:
    () => module.require('./schedule/retry-pending-service-disconnects') as FunctionModule,
  listUsers: loadAdminUsersHandlers,
  getUserCount: loadAdminUsersHandlers,
  getQueueStats: loadAdminQueuesHandlers,
  retrySportsLibReparseHeavyJob: loadAdminQueuesHandlers,
  setSportsLibReparseSettings:
    () => module.require('./admin/handlers/reparse-settings.handlers') as FunctionModule,
  getAdminDashboardHistory: loadAdminDashboardHistoryHandlers,
  scheduleAdminDashboardSnapshot: loadAdminDashboardHistoryHandlers,
  getSubscriptionHistoryTrend: loadAdminTrendsHandlers,
  getUserGrowthTrend: loadAdminTrendsHandlers,
  setMaintenanceMode: loadAdminMaintenanceHandlers,
  getMaintenanceStatus: loadAdminMaintenanceHandlers,
  impersonateUser: loadAdminImpersonationHandlers,
  stopImpersonation: loadAdminImpersonationHandlers,
  getFinancialStats:
    () => module.require('./admin/handlers/financials.handlers') as FunctionModule,
  previewAdminSubscriptionGift: loadAdminSubscriptionGiftHandlers,
  grantAdminSubscriptionGift: loadAdminSubscriptionGiftHandlers,
  listMarketingCampaigns: loadMarketingHandlers,
  saveMarketingCampaign: loadMarketingHandlers,
  cloneMarketingCampaign: loadMarketingHandlers,
  previewMarketingCampaign: loadMarketingHandlers,
  prepareMarketingCampaign: loadMarketingHandlers,
  setMarketingDailyCap: loadMarketingHandlers,
  sendMarketingTest: loadMarketingHandlers,
  changeMarketingCampaignStatus: loadMarketingHandlers,
  dispatchMarketingCampaigns: loadMarketingHandlers,
  trackMarketingDelivery: loadMarketingHandlers,
  marketingUnsubscribe: loadMarketingHandlers,
  reconcileTrainingPlanCleanup:
    () => module.require('./training-plans/cleanup-worker') as FunctionModule,
  reconcileTrainingWorkoutExpiry:
    () => module.require('./training-plans/cleanup-worker') as FunctionModule,
  reconcileTrainingBulkShift:
    () => module.require('./training-plans/bulk-shift-worker') as FunctionModule,
  applyAssistantTrainingProposal:
    () => module.require('./assistant/callable') as FunctionModule,
  ensureDerivedMetrics:
    () => module.require('./derived-metrics/ensure-derived-metrics') as FunctionModule,
  setTrainingBuildBenchmark:
    () => module.require('./derived-metrics/set-training-build-benchmark') as FunctionModule,
  mutateTrainingSchedule:
    () => module.require('./training-plans/mutate-training-schedule') as FunctionModule,
  mutateWorkoutLibrary:
    () => module.require('./training-plans/workout-library-callables') as FunctionModule,
  placeWorkoutLibrary:
    () => module.require('./training-plans/workout-library-callables') as FunctionModule,
  getTrainingScheduleHistory: loadTrainingScheduleHistory,
  previewTrainingScheduleRestore: loadTrainingScheduleHistory,
  restoreTrainingScheduleRevision:
    () => module.require('./training-plans/restore-callable') as FunctionModule,
  deleteTrainingPlan:
    () => module.require('./training-plans/delete-training-plan-callable') as FunctionModule,
  previewTrainingProviderDelivery: loadTrainingDeliveryCommands,
  mutateTrainingProviderDelivery: loadTrainingDeliveryCommands,
  processTrainingDeliveryTask: loadTrainingDeliveryTasks,
  onTrainingDeliveryQueued: loadTrainingDeliveryTasks,
  dispatchTrainingDelivery: loadTrainingDeliveryTasks,
  onTrainingDeliveryConnectionChanged: loadTrainingDeliveryLifecycle,
  onTrainingDeliveryEntitlementChanged: loadTrainingDeliveryLifecycle,
  onDashboardDerivedMetricsActivityWrite: loadDashboardDerivedMetricsTriggers,
  onDashboardDerivedMetricsEventWrite: loadDashboardDerivedMetricsTriggers,
  onDashboardDerivedMetricsSleepWrite: loadDashboardDerivedMetricsTriggers,
  onTrainingLoadMetadataWrite: loadDashboardDerivedMetricsTriggers,
  onDashboardDerivedMetricsHealthWrite: loadDashboardDerivedMetricsTriggers,
  processDerivedMetricsTask:
    () => module.require('./tasks/derived-metrics-worker') as FunctionModule,
  processDerivedMetricsIngressTask:
    () => module.require('./tasks/derived-metrics-ingress-worker') as FunctionModule,
});

export const OPTIMIZED_FUNCTION_TARGETS = Object.freeze(Object.keys(TARGET_LOADERS));

export function resolveRuntimeFunctionTarget(
  environment: Readonly<NodeJS.ProcessEnv>,
): string | undefined {
  // Firebase uses either of these modes while discovering the complete
  // deployment manifest. Ignore an inherited FUNCTION_TARGET so discovery can
  // never collapse the exported inventory to one optimized handler.
  if (
    environment.FUNCTIONS_CONTROL_API === 'true'
    || environment.FUNCTIONS_MANIFEST_OUTPUT_PATH
  ) {
    return undefined;
  }

  return environment.FUNCTION_TARGET?.trim() || undefined;
}

export function loadFunctionTarget(
  target: string,
  targetLoaders: Readonly<Record<string, ModuleLoader>>,
): unknown | undefined {
  const loader = Object.prototype.hasOwnProperty.call(targetLoaders, target)
    ? targetLoaders[target]
    : undefined;
  if (!loader) return undefined;

  const handler = loader()[target];
  if (!handler) {
    throw new Error(`Function target "${target}" was not exported by its configured module.`);
  }
  return handler;
}

export function loadOptimizedFunctionTarget(target: string): unknown | undefined {
  return loadFunctionTarget(target, TARGET_LOADERS);
}
