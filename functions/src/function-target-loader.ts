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
  linkExistingStripeCustomer: () => module.require('./stripe/claims') as FunctionModule,
  restoreUserClaims: () => module.require('./stripe/claims') as FunctionModule,
  getUpcomingRenewalAmount: () => module.require('./stripe/get-upcoming-renewal-amount') as FunctionModule,
  onSubscriptionUpdated: () => module.require('./stripe/subscriptions') as FunctionModule,
  enforceSubscriptionLimits: () => module.require('./schedule/enforce-subscription-limits') as FunctionModule,
  checkSubscriptionNotifications: () => module.require('./schedule/notifications') as FunctionModule,
  cleanupStripeCustomer: () => module.require('./stripe/cleanup') as FunctionModule,
  cleanupUserAccounts: () => module.require('./users/cleanup') as FunctionModule,
  'createStripeCheckoutSession': () => module.require('./stripe/billing/handlers') as FunctionModule,
  'createStripePortalLink': () => module.require('./stripe/billing/handlers') as FunctionModule,
  'ext-firestore-stripe-payments-createPortalLink': () => module.require('./stripe/billing/handlers') as FunctionModule,
  'stripeBillingWebhook': () => module.require('./stripe/billing/handlers') as FunctionModule,
  'dispatchStripeBillingJob': () => module.require('./stripe/billing/handlers') as FunctionModule,
  'recoverStripeBillingJobs': () => module.require('./stripe/billing/handlers') as FunctionModule,
  'processStripeBillingTask': () => module.require('./stripe/billing/handlers') as FunctionModule,
  'deleteStripeCustomerOnDocumentDeleted': () => module.require('./stripe/billing/handlers') as FunctionModule,
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
  processSportsLibReparseTask:
    () => module.require('./tasks/sports-lib-reparse-worker') as FunctionModule,
  processSportsLibReparseHeavyTask:
    () => module.require('./tasks/sports-lib-reparse-worker') as FunctionModule,
  processSportsLibRouteReparseTask:
    () => module.require('./tasks/sports-lib-route-reparse-worker') as FunctionModule,
  scheduleSportsLibReparseScan:
    () => module.require('./schedule/sports-lib-reparse') as FunctionModule,
  scheduleSportsLibRouteReparseScan:
    () => module.require('./schedule/sports-lib-route-reparse') as FunctionModule,
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
  activitySendCommand: () => module.require('./activity-send/commands') as FunctionModule,
  uploadActivitySendFile: () => module.require('./activity-send/upload') as FunctionModule,
  admitActivitySend: () => module.require('./activity-send/lifecycle') as FunctionModule,
  projectActivitySendDelivery: () => module.require('./activity-send/lifecycle') as FunctionModule,
  cleanupActivitySends: () => module.require('./activity-send/lifecycle') as FunctionModule,
  cleanupActivitySendOnDelete: () => module.require('./activity-send/lifecycle') as FunctionModule,
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
  processConnectionHistoryTask:
    () => module.require('./connection-history/tasks') as FunctionModule,
  onConnectionHistoryImportWritten:
    () => module.require('./connection-history/tasks') as FunctionModule,
  recoverConnectionHistoryImports:
    () => module.require('./connection-history/tasks') as FunctionModule,
  retryConnectionHistoryImport:
    () => module.require('./connection-history/tasks') as FunctionModule,
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
  onTrainingDeliveryGuideSettingsChanged: loadTrainingDeliveryLifecycle,
  onDashboardDerivedMetricsActivityWrite: loadDashboardDerivedMetricsTriggers,
  onDashboardDerivedMetricsEventWrite: loadDashboardDerivedMetricsTriggers,
  onDashboardDerivedMetricsSleepWrite: loadDashboardDerivedMetricsTriggers,
  onTrainingLoadMetadataWrite: loadDashboardDerivedMetricsTriggers,
  onDashboardDerivedMetricsHealthWrite: loadDashboardDerivedMetricsTriggers,
  processDerivedMetricsTask:
    () => module.require('./tasks/derived-metrics-worker') as FunctionModule,
  processDerivedMetricsIngressTask:
    () => module.require('./tasks/derived-metrics-ingress-worker') as FunctionModule,
  observeDerivedMetricsHealth:
    () => module.require('./derived-metrics/monitoring-schedule') as FunctionModule,
  // All deployed functions have direct owner-module loaders. Keep the four
  // public callable aliases mapped to their original Firebase handler objects.
  addCOROSAPIHistoryToQueue: () => module.require('./coros/history-to-queue') as FunctionModule,
  addSuuntoAppHistoryToQueue: () => module.require('./suunto/history-to-queue') as FunctionModule,
  addSuuntoAppRoutesToQueue: () => module.require('./suunto/route-sync') as FunctionModule,
  addWahooAPIHistoryToQueue: () => module.require('./wahoo/history-to-queue') as FunctionModule,
  assistantChat: () => module.require('./assistant/callable') as FunctionModule,
  backfillActivitySyncRoute: () => module.require('./activity-sync/backfill') as FunctionModule,
  backfillCorosAPISleep: () => module.require('./sleep/backfill') as FunctionModule,
  backfillGarminAPIActivities: () => module.require('./garmin/backfill') as FunctionModule,
  backfillGarminAPIHealth: () => module.require('./sleep/backfill') as FunctionModule,
  backfillRouteDeliverySyncRoute: () => module.require('./route-delivery-sync/backfill') as FunctionModule,
  backfillSuuntoAppSleep: () => module.require('./sleep/backfill') as FunctionModule,
  cleanupRouteFiles: () => module.require('./routes/cleanup') as FunctionModule,
  createToolComparisonEvent: () => module.require('./events/create-tool-comparison-event') as FunctionModule,
  deauthorizeCOROSAPI: () => module.require('./coros/auth/wrapper') as FunctionModule,
  deauthorizeGarminAPI: () => module.require('./garmin/auth/wrapper') as FunctionModule,
  deauthorizeGarminAPIUsers: () => module.require('./garmin/auth/wrapper') as FunctionModule,
  deauthorizeSuuntoApp: () => module.require('./suunto/auth/wrapper') as FunctionModule,
  deauthorizeWahooAPI: () => module.require('./wahoo/auth/wrapper') as FunctionModule,
  decideMcpAuthorization: () => module.require('./mcp/callables') as FunctionModule,
  deleteManualHealthMeasurement: () => ({
    deleteManualHealthMeasurement: module.require('./health/manual-callable').deleteManualHealthMeasurementCallable,
  }),
  deleteSelf: () => module.require('./user/user') as FunctionModule,
  deleteTimelineNote: () => ({
    deleteTimelineNote: module.require('./timeline-notes/callable').deleteTimelineNoteCallable,
  }),
  disableActivitySyncRoutesOnCOROSTokenRootDelete: () => module.require('./activity-sync/disconnect-routes') as FunctionModule,
  disableActivitySyncRoutesOnGarminTokenRootDelete: () => module.require('./activity-sync/disconnect-routes') as FunctionModule,
  disableActivitySyncRoutesOnSuuntoTokenRootDelete: () => module.require('./activity-sync/disconnect-routes') as FunctionModule,
  disableActivitySyncRoutesOnWahooTokenRootDelete: () => module.require('./activity-sync/disconnect-routes') as FunctionModule,
  getAssistantConversation: () => module.require('./assistant/callable') as FunctionModule,
  getAssistantQuotaStatus: () => module.require('./assistant/callable') as FunctionModule,
  getCOROSAPIAuthRequestTokenRedirectURI: () => module.require('./coros/auth/wrapper') as FunctionModule,
  getCOROSAPIBindingState: () => module.require('./coros/binding-state') as FunctionModule,
  getCOROSAPIWorkoutFileUploadStatus: () => module.require('./coros/activities') as FunctionModule,
  getGarminAPIAuthRequestTokenRedirectURI: () => module.require('./garmin/auth/wrapper') as FunctionModule,
  getGarminHealthSyncAvailability: () => module.require('./garmin/health-availability') as FunctionModule,
  getMcpAuthorizationRequest: () => module.require('./mcp/callables') as FunctionModule,
  getSuuntoHealthSyncAvailability: () => module.require('./suunto/health-availability') as FunctionModule,
  getWahooAPIAuthRequestTokenRedirectURI: () => module.require('./wahoo/auth/wrapper') as FunctionModule,
  getWahooAPIConnectionAccount: () => module.require('./wahoo/auth/wrapper') as FunctionModule,
  getWahooAPIWorkoutFileUploadStatus: () => module.require('./wahoo/activities') as FunctionModule,
  importActivityToCOROSAPI: () => module.require('./coros/activities') as FunctionModule,
  importActivityToSuuntoApp: () => module.require('./suunto/activities') as FunctionModule,
  importActivityToWahooAPI: () => module.require('./wahoo/activities') as FunctionModule,
  importRouteToCOROSAPI: () => module.require('./coros/routes') as FunctionModule,
  importRouteToGarminAPI: () => module.require('./garmin/manual-route-upload') as FunctionModule,
  importRouteToSuuntoApp: () => module.require('./suunto/routes') as FunctionModule,
  importRouteToWahooAPI: () => module.require('./wahoo/routes') as FunctionModule,
  insertCOROSAPIWorkoutDataToQueue: () => module.require('./coros/queue') as FunctionModule,
  insertGarminAPIActivityFileToQueue: () => module.require('./garmin/queue') as FunctionModule,
  insertSuuntoAppActivityToQueue: () => module.require('./suunto/queue') as FunctionModule,
  insertSuuntoAppRouteToQueue: () => module.require('./suunto/route-sync') as FunctionModule,
  listMcpConnections: () => module.require('./mcp/callables') as FunctionModule,
  mergeEvents: () => module.require('./events/merge-events') as FunctionModule,
  projectCOROSConnectionOnTokenWrite: () => module.require('./service-connection-account-projection') as FunctionModule,
  queryActivityHealthRange: () => module.require('./health/activity-callable') as FunctionModule,
  queryHealthRange: () => module.require('./health/callable') as FunctionModule,
  receiveGarminAPIUserPermissions: () => module.require('./garmin/auth/wrapper') as FunctionModule,
  refreshCOROSAPIRefreshTokens: () => module.require('./coros/tokens') as FunctionModule,
  refreshGarminAPIRefreshTokens: () => module.require('./garmin/tokens') as FunctionModule,
  refreshSuuntoAppRefreshTokens: () => module.require('./suunto/tokens') as FunctionModule,
  reprocessEvent: () => module.require('./events/reprocess-event') as FunctionModule,
  reprocessRoute: () => module.require('./routes/reprocess-route') as FunctionModule,
  requestAndSetCOROSAPIAccessToken: () => module.require('./coros/auth/wrapper') as FunctionModule,
  requestAndSetGarminAPIAccessToken: () => module.require('./garmin/auth/wrapper') as FunctionModule,
  requestAndSetWahooAPIAccessToken: () => module.require('./wahoo/auth/wrapper') as FunctionModule,
  resetAssistantConversation: () => module.require('./assistant/callable') as FunctionModule,
  revokeMcpConnection: () => module.require('./mcp/callables') as FunctionModule,
  saveManualHealthMeasurement: () => ({
    saveManualHealthMeasurement: module.require('./health/manual-callable').saveManualHealthMeasurementCallable,
  }),
  saveTimelineNote: () => ({
    saveTimelineNote: module.require('./timeline-notes/callable').saveTimelineNoteCallable,
  }),
  scheduleCOROSSleepSync: () => module.require('./sleep/polling') as FunctionModule,
  sendRegistrationWelcomeEmail: () => module.require('./email/registration-welcome') as FunctionModule,
  sendRoutesToService: () => module.require('./routes/send-routes-to-service') as FunctionModule,
  setEventSharing: () => module.require('./events/set-event-sharing') as FunctionModule,
  uploadRoute: () => module.require('./routes/upload-route') as FunctionModule,
  wahooAPIWebhook: () => module.require('./wahoo/webhook') as FunctionModule,
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

  const target = environment.FUNCTION_TARGET?.trim();
  return target === 'ext.firestore.stripe.payments.createPortalLink'
    ? 'ext-firestore-stripe-payments-createPortalLink' : target || undefined;
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
