import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  loadOptimizedFunctionTarget,
  OPTIMIZED_FUNCTION_TARGETS,
  resolveRuntimeFunctionTarget,
} from '../function-target-loader';

const NO_TARGET = '__NO_TARGET__';
// Exercise a property inherited from Object.prototype so the fallback check
// also guards against accidental prototype-based routing.
const UNKNOWN_TARGET = 'toString';
const EXPECTED_FULL_EXPORT_COUNT = 172;
const MARKETING_TARGETS = new Set([
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
]);
const MARKETING_SECRET_TARGETS = new Set([
  'sendMarketingTest',
  'changeMarketingCampaignStatus',
  'dispatchMarketingCampaigns',
  'marketingUnsubscribe',
]);
const ADMIN_TARGET_METADATA: Readonly<Record<string, {
  ownerModule: string;
  memoryMb: number;
  timeoutSeconds: number | null;
  trigger: 'callable' | 'schedule';
  secrets?: readonly string[];
  allowsMcp?: boolean;
  allowsBigQuery?: boolean;
}>> = {
  listUsers: { ownerModule: 'users.handlers', memoryMb: 512, timeoutSeconds: 120, trigger: 'callable', allowsMcp: true },
  getUserCount: { ownerModule: 'users.handlers', memoryMb: 512, timeoutSeconds: null, trigger: 'callable', allowsMcp: true },
  getQueueStats: { ownerModule: 'queues.handlers', memoryMb: 512, timeoutSeconds: null, trigger: 'callable' },
  retrySportsLibReparseHeavyJob: { ownerModule: 'queues.handlers', memoryMb: 256, timeoutSeconds: null, trigger: 'callable' },
  setSportsLibReparseSettings: { ownerModule: 'reparse-settings.handlers', memoryMb: 256, timeoutSeconds: null, trigger: 'callable' },
  getAdminDashboardHistory: { ownerModule: 'dashboard-history.handlers', memoryMb: 512, timeoutSeconds: null, trigger: 'callable' },
  scheduleAdminDashboardSnapshot: { ownerModule: 'dashboard-history.handlers', memoryMb: 512, timeoutSeconds: 300, trigger: 'schedule' },
  getSubscriptionHistoryTrend: { ownerModule: 'trends.handlers', memoryMb: 512, timeoutSeconds: null, trigger: 'callable' },
  getUserGrowthTrend: { ownerModule: 'trends.handlers', memoryMb: 512, timeoutSeconds: null, trigger: 'callable' },
  setMaintenanceMode: { ownerModule: 'maintenance.handlers', memoryMb: 256, timeoutSeconds: null, trigger: 'callable' },
  getMaintenanceStatus: { ownerModule: 'maintenance.handlers', memoryMb: 512, timeoutSeconds: null, trigger: 'callable' },
  impersonateUser: { ownerModule: 'impersonation.handlers', memoryMb: 256, timeoutSeconds: null, trigger: 'callable' },
  stopImpersonation: { ownerModule: 'impersonation.handlers', memoryMb: 256, timeoutSeconds: null, trigger: 'callable' },
  getFinancialStats: { ownerModule: 'financials.handlers', memoryMb: 512, timeoutSeconds: null, trigger: 'callable', secrets: ['STRIPE_SECRET_KEY'], allowsBigQuery: true },
  previewAdminSubscriptionGift: { ownerModule: 'subscription-gifts.handlers', memoryMb: 512, timeoutSeconds: null, trigger: 'callable', secrets: ['STRIPE_ADMIN_BILLING_KEY'] },
  grantAdminSubscriptionGift: { ownerModule: 'subscription-gifts.handlers', memoryMb: 512, timeoutSeconds: 60, trigger: 'callable', secrets: ['STRIPE_ADMIN_BILLING_KEY'] },
};
const CONNECTION_PROJECTION_TARGET_DOCUMENTS: Readonly<Record<string, string>> = {
  projectSuuntoConnectionOnTokenWrite: 'suuntoAppAccessTokens/{userID}/tokens/{tokenID}',
  projectGarminConnectionOnTokenWrite: 'garminAPITokens/{userID}/tokens/{tokenID}',
};
const PROVIDER_CONNECTION_AND_HEALTH_TARGETS = [
  ...Object.keys(CONNECTION_PROJECTION_TARGET_DOCUMENTS),
  'receiveGarminAPIHealthData',
];
const QUEUE_AND_CLEANUP_TARGETS = [
  'processGarminHealthBackfillTask',
  'processActivitySyncTask',
  'processRouteSyncTask',
  'processRouteDeliverySyncTask',
  'cleanupRejectedRouteOriginalFile',
  'cleanupEventFile',
  'dispatchGarminPingBatchOnWrite',
];
const GEN1_DISPATCHER_METADATA: Readonly<Record<string, {
  memoryMb: number;
  timeoutSeconds: number;
}>> = {
  dispatchSleepSyncQueue: { memoryMb: 256, timeoutSeconds: 300 },
  dispatchActivitySyncQueue: { memoryMb: 256, timeoutSeconds: 300 },
  dispatchRouteDeliverySyncQueue: { memoryMb: 256, timeoutSeconds: 300 },
  parseGarminAPIActivityQueue: { memoryMb: 1024, timeoutSeconds: 540 },
  parseSuuntoAppActivityQueue: { memoryMb: 1024, timeoutSeconds: 540 },
  parseCOROSAPIWorkoutQueue: { memoryMb: 256, timeoutSeconds: 300 },
  parseWahooAPIWorkoutQueue: { memoryMb: 1024, timeoutSeconds: 540 },
};
const RUNTIME_CONTRACT_TARGETS = [
  ...Object.keys(GEN1_DISPATCHER_METADATA),
  'processGarminHealthBackfillTask',
];
const INGESTION_TARGET_METADATA: Readonly<Record<string, {
  memoryMb: number;
  timeoutSeconds: number | null;
  trigger: 'http' | 'event' | 'task';
  secrets?: readonly string[];
  eventDocument?: string;
  eventType?: string;
  eventRetry?: boolean;
  maxConcurrentDispatches?: number;
  maxDispatchesPerSecond?: number;
  concurrency?: number;
  maxInstances?: number;
  cpu?: number;
}>> = {
  processSleepSyncTask: { memoryMb: 1024, timeoutSeconds: 540, trigger: 'task', secrets: [
    'COROSAPI_CLIENT_ID', 'COROSAPI_CLIENT_SECRET', 'GARMINAPI_CLIENT_ID', 'GARMINAPI_CLIENT_SECRET',
    'SUUNTOAPP_CLIENT_ID', 'SUUNTOAPP_CLIENT_SECRET', 'SUUNTOAPP_SUBSCRIPTION_KEY',
  ] },
  processGarminHealthBackfillTask: {
    memoryMb: 512, timeoutSeconds: 1800, trigger: 'task',
    maxConcurrentDispatches: 1, maxDispatchesPerSecond: 1,
    secrets: ['GARMINAPI_CLIENT_ID', 'GARMINAPI_CLIENT_SECRET'],
  },
  processWorkoutTask: { memoryMb: 1024, timeoutSeconds: 540, trigger: 'task', secrets: [
    'COROSAPI_CLIENT_ID', 'COROSAPI_CLIENT_SECRET', 'GARMINAPI_CLIENT_ID', 'GARMINAPI_CLIENT_SECRET',
    'SUUNTOAPP_CLIENT_ID', 'SUUNTOAPP_CLIENT_SECRET', 'SUUNTOAPP_SUBSCRIPTION_KEY',
    'WAHOOAPI_ALLOWED_FILE_HOSTS',
  ] },
  processActivitySyncTask: {
    memoryMb: 1024, timeoutSeconds: 540, trigger: 'task',
    maxConcurrentDispatches: 500, maxDispatchesPerSecond: 250,
    secrets: [
      'COROSAPI_CLIENT_ID', 'COROSAPI_CLIENT_SECRET',
      'SUUNTOAPP_CLIENT_ID', 'SUUNTOAPP_CLIENT_SECRET', 'SUUNTOAPP_SUBSCRIPTION_KEY',
      'WAHOOAPI_CLIENT_ID', 'WAHOOAPI_CLIENT_SECRET',
    ],
  },
  processRouteSyncTask: { memoryMb: 1024, timeoutSeconds: 540, trigger: 'task', secrets: [
    'SUUNTOAPP_CLIENT_ID', 'SUUNTOAPP_CLIENT_SECRET', 'SUUNTOAPP_SUBSCRIPTION_KEY',
  ] },
  processRouteDeliverySyncTask: { memoryMb: 1024, timeoutSeconds: 540, trigger: 'task', secrets: [
    'COROSAPI_CLIENT_ID', 'COROSAPI_CLIENT_SECRET', 'GARMINAPI_CLIENT_ID', 'GARMINAPI_CLIENT_SECRET',
    'SUUNTOAPP_CLIENT_ID', 'SUUNTOAPP_CLIENT_SECRET', 'SUUNTOAPP_SUBSCRIPTION_KEY', 'WAHOOAPI_CLIENT_ID', 'WAHOOAPI_CLIENT_SECRET',
  ] },
  cleanupRejectedRouteOriginalFile: {
    memoryMb: 256, timeoutSeconds: 60, trigger: 'event', concurrency: 1, maxInstances: 20,
    eventDocument: 'routeOriginalFileCleanup/{cleanupID}', eventType: 'google.cloud.firestore.document.v1.updated', eventRetry: true,
  },
  cleanupEventFile: {
    memoryMb: 1024, timeoutSeconds: 300, trigger: 'event', concurrency: 5, maxInstances: 10,
    eventDocument: 'users/{userId}/events/{eventId}',
    eventType: 'google.cloud.firestore.document.v1.deleted', eventRetry: false,
  },
  uploadActivity: { memoryMb: 4096, timeoutSeconds: 3600, trigger: 'http', cpu: 2, concurrency: 1, maxInstances: 20 },
  fanOutSuuntoHealthWebhookIngress: {
    memoryMb: 512, timeoutSeconds: 120, trigger: 'event', concurrency: 1, maxInstances: 50,
    eventDocument: 'suuntoHealthWebhookIngress/{ingressID}',
  },
  dispatchGarminPingBatchOnWrite: {
    memoryMb: 512, timeoutSeconds: null, trigger: 'event', concurrency: 10, maxInstances: 100,
    eventDocument: 'sleepSyncQueue/{queueItemId}',
    eventType: 'google.cloud.firestore.document.v1.written', eventRetry: true,
  },
};
const SCHEDULED_MAINTENANCE_TARGET_METADATA: Readonly<Record<string, {
  timeoutSeconds: number;
  maxInstances?: number;
  secrets?: readonly string[];
}>> = {
  scheduleSuuntoHealthSync: { timeoutSeconds: 300 },
  scheduleSuuntoSleepSync: { timeoutSeconds: 300 },
  redriveRejectedRouteOriginalCleanup: { timeoutSeconds: 540, maxInstances: 1 },
  retryPendingServiceDisconnects: { timeoutSeconds: 300, secrets: [
    'COROSAPI_CLIENT_ID', 'COROSAPI_CLIENT_SECRET', 'GARMINAPI_CLIENT_ID', 'GARMINAPI_CLIENT_SECRET',
    'SUUNTOAPP_CLIENT_ID', 'SUUNTOAPP_CLIENT_SECRET', 'WAHOOAPI_CLIENT_ID', 'WAHOOAPI_CLIENT_SECRET',
  ] },
};
const TRAINING_TARGET_METADATA: Readonly<Record<string, {
  memoryMb: number;
  timeoutSeconds: number | null;
  trigger: 'callable' | 'event' | 'schedule' | 'task';
  secrets?: readonly string[];
  eventDocument?: string;
  schedule?: string;
  concurrency?: number | null;
  maxInstances?: number | null;
  minInstances?: number | null;
}>> = {
  applyAssistantTrainingProposal: { memoryMb: 512, timeoutSeconds: null, trigger: 'callable', secrets: ['SUUNTOAPP_GUIDE_OWNER'] },
  ensureDerivedMetrics: { memoryMb: 512, timeoutSeconds: 120, trigger: 'callable', maxInstances: 100 },
  setTrainingBuildBenchmark: { memoryMb: 512, timeoutSeconds: null, trigger: 'callable' },
  mutateTrainingSchedule: { memoryMb: 512, timeoutSeconds: 300, trigger: 'callable' },
  mutateWorkoutLibrary: { memoryMb: 512, timeoutSeconds: 120, trigger: 'callable' },
  placeWorkoutLibrary: { memoryMb: 512, timeoutSeconds: 300, trigger: 'callable' },
  getTrainingScheduleHistory: { memoryMb: 512, timeoutSeconds: null, trigger: 'callable' },
  previewTrainingScheduleRestore: { memoryMb: 512, timeoutSeconds: null, trigger: 'callable' },
  restoreTrainingScheduleRevision: { memoryMb: 512, timeoutSeconds: null, trigger: 'callable' },
  deleteTrainingPlan: { memoryMb: 1024, timeoutSeconds: 540, trigger: 'callable' },
  previewTrainingProviderDelivery: { memoryMb: 512, timeoutSeconds: null, trigger: 'callable', secrets: ['SUUNTOAPP_GUIDE_OWNER'] },
  mutateTrainingProviderDelivery: { memoryMb: 512, timeoutSeconds: null, trigger: 'callable', secrets: ['SUUNTOAPP_GUIDE_OWNER'] },
  processTrainingDeliveryTask: { memoryMb: 512, timeoutSeconds: 120, trigger: 'task', secrets: [
    'COROSAPI_CLIENT_ID', 'COROSAPI_CLIENT_SECRET', 'GARMINAPI_CLIENT_ID', 'GARMINAPI_CLIENT_SECRET',
    'SUUNTOAPP_CLIENT_ID', 'SUUNTOAPP_CLIENT_SECRET', 'SUUNTOAPP_SUBSCRIPTION_KEY',
    'SUUNTOAPP_GUIDE_OWNER', 'WAHOOAPI_CLIENT_ID', 'WAHOOAPI_CLIENT_SECRET',
  ] },
  onTrainingDeliveryQueued: { memoryMb: 512, timeoutSeconds: null, trigger: 'event', eventDocument: 'trainingDeliveryQueue/{jobId}' },
  dispatchTrainingDelivery: { memoryMb: 512, timeoutSeconds: 120, trigger: 'schedule', schedule: '* * * * *' },
  onTrainingDeliveryConnectionChanged: { memoryMb: 512, timeoutSeconds: null, trigger: 'event', eventDocument: 'users/{uid}/meta/{service}' },
  onTrainingDeliveryEntitlementChanged: { memoryMb: 512, timeoutSeconds: null, trigger: 'event', eventDocument: 'users/{uid}/system/status' },
  onDashboardDerivedMetricsActivityWrite: { memoryMb: 512, timeoutSeconds: null, trigger: 'event', eventDocument: 'users/{uid}/activities/{activityId}', concurrency: 1, maxInstances: 50 },
  onDashboardDerivedMetricsEventWrite: { memoryMb: 512, timeoutSeconds: null, trigger: 'event', eventDocument: 'users/{uid}/events/{eventId}', concurrency: 1, maxInstances: 50 },
  onDashboardDerivedMetricsSleepWrite: { memoryMb: 512, timeoutSeconds: null, trigger: 'event', eventDocument: 'users/{uid}/sleepSessions/{sleepSessionId}', concurrency: 1, maxInstances: 50 },
  onDashboardDerivedMetricsHealthWrite: { memoryMb: 512, timeoutSeconds: null, trigger: 'event', eventDocument: 'users/{uid}/healthSourceRecords/{sourceRecordId}', concurrency: 1, maxInstances: 50 },
  processDerivedMetricsTask: { memoryMb: 2048, timeoutSeconds: 540, trigger: 'task', concurrency: 1 },
  processDerivedMetricsIngressTask: { memoryMb: 512, timeoutSeconds: 120, trigger: 'task' },
};

interface ProbeResult {
  target: string | null;
  exports: string[];
  matchesFullEntrypoint: boolean | null;
  preservesHandlerIdentity: boolean | null;
  forbiddenModules: string[];
  isolatedRuntimeContracts: Record<string, unknown>;
}

interface DiscoveredEndpoint {
  platform?: string;
  region?: string[];
  availableMemoryMb?: number;
  timeoutSeconds?: number | null;
  concurrency?: number | null;
  maxInstances?: number | null;
  minInstances?: number | null;
  cpu?: number | 'gcf_gen1';
  entryPoint?: string;
  secretEnvironmentVariables?: Array<{ key?: string }>;
  callableTrigger?: unknown;
  scheduleTrigger?: { schedule?: string; timeZone?: string; retryConfig?: Record<string, unknown> };
  eventTrigger?: {
    eventType?: string;
    eventFilterPathPatterns?: { document?: string };
    retry?: boolean;
  };
  httpsTrigger?: { invoker?: string[] };
  taskQueueTrigger?: {
    retryConfig?: {
      maxAttempts?: number;
      maxDoublings?: number;
      maxRetrySeconds?: number | null;
      minBackoffSeconds?: number;
      maxBackoffSeconds?: number;
    };
    rateLimits?: {
      maxConcurrentDispatches?: number | null;
      maxDispatchesPerSecond?: number | null;
    };
  };
}

interface DiscoveredStack {
  endpoints: Record<string, DiscoveredEndpoint>;
}

type DiscoveryMode = 'none' | 'control-api' | 'manifest-output';

function sortedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function probe(targetArgument: string): void {
  if (targetArgument === NO_TARGET) delete process.env.FUNCTION_TARGET;

  const entrypoint = module.require(resolve(__dirname, '..', 'index')) as Record<string, unknown>;
  const target = process.env.FUNCTION_TARGET?.trim() || null;
  const runtimeTarget = resolveRuntimeFunctionTarget(process.env);
  const exports = sortedKeys(entrypoint);
  const isolatedRuntimeContracts: Record<string, unknown> = {};
  for (const contractTarget of RUNTIME_CONTRACT_TARGETS) {
    if (!exports.includes(contractTarget)) continue;
    const handler = entrypoint[contractTarget] as { __endpoint?: unknown; __trigger?: unknown };
    // Capture before loading full-entrypoint below. Same-process identity alone
    // cannot detect runtime-only metadata changes caused by module import order.
    // JSON also normalizes Firebase ResetValue objects to their wire value.
    isolatedRuntimeContracts[contractTarget] = JSON.parse(JSON.stringify({
      endpoint: handler.__endpoint,
      trigger: handler.__trigger,
    })) as unknown;
  }
  let matchesFullEntrypoint: boolean | null = null;
  let preservesHandlerIdentity: boolean | null = null;

  if (runtimeTarget && OPTIMIZED_FUNCTION_TARGETS.includes(runtimeTarget)) {
    preservesHandlerIdentity = entrypoint[runtimeTarget]
      === loadOptimizedFunctionTarget(runtimeTarget);
  } else {
    const fullEntrypoint = module.require(
      resolve(__dirname, '..', 'full-entrypoint'),
    ) as Record<string, unknown>;
    matchesFullEntrypoint = arraysEqual(exports, sortedKeys(fullEntrypoint));
  }

  const normalizedModules = Object.keys(require.cache).map(path => path.replace(/\\/g, '/'));
  const marketingTarget = runtimeTarget != null && MARKETING_TARGETS.has(runtimeTarget);
  const adminTarget = runtimeTarget ? ADMIN_TARGET_METADATA[runtimeTarget] : undefined;
  const assistantProposalTarget = runtimeTarget === 'applyAssistantTrainingProposal';
  const derivedRefreshTarget = runtimeTarget === 'ensureDerivedMetrics';
  const mcpTarget = runtimeTarget === 'mcpApi';
  const forbiddenModules = normalizedModules.filter(path => {
    if (path.endsWith('/lib/functions/src/full-entrypoint.js')) return true;
    if (
      (path.includes('/node_modules/@genkit-ai/') && !assistantProposalTarget)
      || (path.includes('/node_modules/genkit/') && !assistantProposalTarget)
      || (path.includes('/node_modules/@google-cloud/bigquery/') && !adminTarget?.allowsBigQuery)
      || (path.includes('/lib/functions/src/mcp/')
        && !assistantProposalTarget && !derivedRefreshTarget && !mcpTarget && !adminTarget?.allowsMcp)
    ) return true;
    if (!path.includes('/lib/functions/src/admin/')) return false;
    if (adminTarget) {
      return !(
        path.endsWith('/lib/functions/src/admin/handlers/' + adminTarget.ownerModule + '.js')
        || path.includes('/lib/functions/src/admin/shared/')
        || (adminTarget.ownerModule === 'queues.handlers'
          && path.endsWith('/lib/functions/src/admin/handlers/training-delivery-queue.stats.js'))
      );
    }
    return !marketingTarget || !(
      path.includes('/lib/functions/src/admin/marketing/')
      || path.endsWith('/lib/functions/src/admin/shared/subscription.constants.js')
    );
  });

  if (runtimeTarget && OPTIMIZED_FUNCTION_TARGETS.includes(runtimeTarget)) {
    // Snapshot the isolated import graph above, then compare with discovery's
    // authoritative export. Importing the full entrypoint before that snapshot
    // would make every isolated target appear to load the entire application.
    const fullEntrypoint = module.require(
      resolve(__dirname, '..', 'full-entrypoint'),
    ) as Record<string, unknown>;
    matchesFullEntrypoint = entrypoint[runtimeTarget] === fullEntrypoint[runtimeTarget];
  }

  const result: ProbeResult = {
    target,
    exports,
    matchesFullEntrypoint,
    preservesHandlerIdentity,
    forbiddenModules,
    isolatedRuntimeContracts,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function runProbe(target: string, discoveryMode: DiscoveryMode = 'none'): ProbeResult {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GCLOUD_PROJECT: process.env.GCLOUD_PROJECT || 'quantified-self-io',
  };
  delete env.FUNCTIONS_CONTROL_API;
  delete env.FUNCTIONS_MANIFEST_OUTPUT_PATH;
  if (target === NO_TARGET) {
    delete env.FUNCTION_TARGET;
  } else {
    env.FUNCTION_TARGET = target;
  }
  if (discoveryMode === 'control-api') {
    env.FUNCTIONS_CONTROL_API = 'true';
  } else if (discoveryMode === 'manifest-output') {
    env.FUNCTIONS_MANIFEST_OUTPUT_PATH = '/tmp/functions.yaml';
  }
  const child = spawnSync(process.execPath, [__filename, '--probe', target], {
    cwd: resolve(__dirname, '..', '..', '..', '..'),
    env,
    encoding: 'utf8',
  });
  if (child.status !== 0) {
    throw new Error(`Entrypoint probe failed for ${target}: ${child.stderr || child.stdout}`);
  }
  return JSON.parse(child.stdout.trim()) as ProbeResult;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function checkSecretBindingsWithInheritedTarget(target: string): void {
  const env: NodeJS.ProcessEnv = { ...process.env, FUNCTION_TARGET: target };
  // Exercise the standalone predeploy check without letting the caller's
  // discovery mode hide an inherited-target regression.
  delete env.FUNCTIONS_CONTROL_API;
  delete env.FUNCTIONS_MANIFEST_OUTPUT_PATH;
  const child = spawnSync(process.execPath, [resolve(__dirname, 'check-secret-bindings.js')], {
    cwd: resolve(__dirname, '..', '..', '..', '..'),
    env,
    encoding: 'utf8',
  });
  assert(child.status === 0,
    `Secret-binding validation failed with inherited ${target}: ${child.stderr || child.stdout}`);
}

async function loadFirebaseManifest(): Promise<DiscoveredStack> {
  delete process.env.FUNCTION_TARGET;
  delete process.env.FUNCTIONS_MANIFEST_OUTPUT_PATH;
  process.env.FUNCTIONS_CONTROL_API = 'true';
  process.env.GCLOUD_PROJECT ||= 'quantified-self-io';
  process.env.FIREBASE_CONFIG ||= JSON.stringify({
    projectId: process.env.GCLOUD_PROJECT,
    databaseURL: `https://${process.env.GCLOUD_PROJECT}.firebaseio.com`,
  });
  const functionsDirectory = resolve(__dirname, '..', '..', '..', '..');
  const runtimeLoader = module.require(resolve(
    functionsDirectory,
    'node_modules',
    'firebase-functions',
    'lib',
    'runtime',
    'loader.js',
  )) as {
    loadStack: (directory: string) => Promise<DiscoveredStack>;
  };
  return runtimeLoader.loadStack(functionsDirectory);
}

async function check(): Promise<void> {
  const discovery = runProbe(NO_TARGET);
  assert(discovery.matchesFullEntrypoint, 'Discovery exports do not match the complete entrypoint.');
  assert(!discovery.exports.includes('garminWebhookProbe'), 'The retired Garmin probe is still exported.');
  assert(
    discovery.exports.length === EXPECTED_FULL_EXPORT_COUNT,
    `Expected ${EXPECTED_FULL_EXPORT_COUNT} discovery exports, found ${discovery.exports.length}.`,
  );
  assert(arraysEqual(sortedKeys(discovery.isolatedRuntimeContracts),
    [...RUNTIME_CONTRACT_TARGETS].sort()),
  'Full discovery is missing an isolated runtime contract.');

  const unknown = runProbe(UNKNOWN_TARGET);
  assert(unknown.matchesFullEntrypoint, 'An unknown runtime target did not use the complete entrypoint.');
  assert(
    arraysEqual(discovery.exports, unknown.exports),
    'Unknown-target exports differ from discovery exports.',
  );

  const canaryTarget = OPTIMIZED_FUNCTION_TARGETS[0];
  assert(canaryTarget, 'The optimized target registry is empty.');
  for (const target of [
    ...PROVIDER_CONNECTION_AND_HEALTH_TARGETS,
    ...Object.keys(GEN1_DISPATCHER_METADATA),
    ...Object.keys(INGESTION_TARGET_METADATA),
    ...Object.keys(SCHEDULED_MAINTENANCE_TARGET_METADATA),
    ...Object.keys(ADMIN_TARGET_METADATA),
    ...Object.keys(TRAINING_TARGET_METADATA),
  ]) {
    assert(OPTIMIZED_FUNCTION_TARGETS.includes(target), `${target} is missing its isolated loader.`);
  }
  for (const target of [
    canaryTarget,
    'impersonateUser',
    ...PROVIDER_CONNECTION_AND_HEALTH_TARGETS,
    ...QUEUE_AND_CLEANUP_TARGETS,
    ...Object.keys(GEN1_DISPATCHER_METADATA),
    'listUsers',
    'scheduleAdminDashboardSnapshot',
    'grantAdminSubscriptionGift',
  ]) {
    for (const discoveryMode of ['control-api', 'manifest-output'] as const) {
      const guardedDiscovery = runProbe(target, discoveryMode);
      assert(
        guardedDiscovery.matchesFullEntrypoint
          && arraysEqual(discovery.exports, guardedDiscovery.exports),
        `Firebase ${discoveryMode} discovery honored an inherited FUNCTION_TARGET=${target}.`,
      );
      assert(isDeepStrictEqual(guardedDiscovery.isolatedRuntimeContracts,
        discovery.isolatedRuntimeContracts),
      `Firebase ${discoveryMode} discovery changed runtime metadata with inherited ${target}.`);
    }
  }

  for (const target of OPTIMIZED_FUNCTION_TARGETS) {
    const optimized = runProbe(target);
    assert(
      arraysEqual(optimized.exports, [target]),
      `${target} exposed unexpected exports: ${optimized.exports.join(', ')}`,
    );
    assert(optimized.preservesHandlerIdentity, `${target} did not preserve its Firebase handler object.`);
    assert(optimized.matchesFullEntrypoint, `${target} differs from the full-entrypoint handler.`);
    if (RUNTIME_CONTRACT_TARGETS.includes(target)) {
      assert(isDeepStrictEqual(optimized.isolatedRuntimeContracts[target],
        discovery.isolatedRuntimeContracts[target]),
      `${target} isolated runtime endpoint/trigger metadata differs from fresh full discovery.`);
    }
    assert(
      optimized.forbiddenModules.length === 0,
      `${target} loaded unrelated modules: ${optimized.forbiddenModules.join(', ')}`,
    );
  }

  for (const target of [
    ...PROVIDER_CONNECTION_AND_HEALTH_TARGETS,
    ...Object.keys(GEN1_DISPATCHER_METADATA),
    ...Object.keys(INGESTION_TARGET_METADATA),
    ...Object.keys(SCHEDULED_MAINTENANCE_TARGET_METADATA),
    ...Object.keys(ADMIN_TARGET_METADATA),
  ]) {
    checkSecretBindingsWithInheritedTarget(target);
  }

  const stack = await loadFirebaseManifest();
  const endpointNames = Object.keys(stack.endpoints).sort();
  const adminExports = Object.keys(module.require(resolve(__dirname, '..', 'admin')) as Record<string, unknown>);
  for (const target of adminExports) {
    assert(OPTIMIZED_FUNCTION_TARGETS.includes(target), target + ' is missing its isolated admin loader.');
    assert(stack.endpoints[target] !== undefined, target + ' is missing from Firebase discovery.');
  }
  assert(
    arraysEqual(discovery.exports, endpointNames),
    'Firebase manifest endpoints differ from the complete discovery exports.',
  );
  assert(!('projectEventTagCatalog' in stack.endpoints), 'Retired event tag trigger is still exported.');

  const firstGenerationEndpoint = Object.entries(stack.endpoints)
    .find(([target, endpoint]) => endpoint.platform === 'gcfv1'
      && !OPTIMIZED_FUNCTION_TARGETS.includes(target));
  assert(firstGenerationEndpoint, 'Firebase manifest no longer contains a Gen 1 fallback target.');
  const firstGeneration = runProbe(firstGenerationEndpoint[0]);
  assert(
    firstGeneration.matchesFullEntrypoint
      && arraysEqual(discovery.exports, firstGeneration.exports),
    `${firstGenerationEndpoint[0]} did not retain the complete Gen 1 entrypoint fallback.`,
  );

  for (const target of OPTIMIZED_FUNCTION_TARGETS) {
    const endpoint = stack.endpoints[target];
    const expectedPlatform = target === 'receiveSuunto247Data' || target === 'receiveGarminAPIHealthData'
      || GEN1_DISPATCHER_METADATA[target]
      ? 'gcfv1' : 'gcfv2';
    assert(endpoint?.platform === expectedPlatform, `${target} runtime generation changed.`);
    assert(endpoint.entryPoint === target, `${target} entrypoint metadata changed.`);
    assert(
      arraysEqual(endpoint.region || [], ['europe-west2']),
      `${target} region metadata changed.`,
    );
    const secretKeys = (endpoint.secretEnvironmentVariables || [])
      .map(secret => secret.key || '')
      .sort();
    if (target === 'mcpApi') {
      assert(endpoint.availableMemoryMb === 1024, `${target} memory configuration changed.`);
      assert(endpoint.timeoutSeconds === 120, `${target} timeout configuration changed.`);
      assert(endpoint.concurrency === 4
        && JSON.stringify(endpoint.minInstances) === 'null'
        && JSON.stringify(endpoint.maxInstances) === 'null',
      `${target} instance settings changed.`);
      assert(arraysEqual(secretKeys, ['MAPBOX_ACCESS_TOKEN', 'SUUNTOAPP_GUIDE_OWNER']), `${target} secret bindings changed.`);
      assert(endpoint.httpsTrigger !== undefined
        && endpoint.callableTrigger === undefined
        && endpoint.eventTrigger === undefined
        && endpoint.taskQueueTrigger === undefined
        && endpoint.scheduleTrigger === undefined,
      `${target} HTTP trigger changed.`);
    } else if (target === 'receiveSuunto247Data') {
      assert(endpoint.availableMemoryMb === 512, `${target} memory configuration changed.`);
      assert(endpoint.timeoutSeconds === 60, `${target} timeout configuration changed.`);
      assert(JSON.stringify(endpoint.minInstances) === 'null'
        && JSON.stringify(endpoint.maxInstances) === 'null'
        && endpoint.concurrency === undefined,
      `${target} instance settings changed.`);
      assert(arraysEqual(secretKeys, ['SUUNTOAPP_NOTIFICATION_SECRET']), `${target} secret bindings changed.`);
      assert(endpoint.httpsTrigger !== undefined
        && endpoint.callableTrigger === undefined
        && endpoint.eventTrigger === undefined
        && endpoint.taskQueueTrigger === undefined
        && endpoint.scheduleTrigger === undefined,
      `${target} HTTP trigger changed.`);
    } else if (target === 'receiveGarminAPIHealthData') {
      assert(endpoint.availableMemoryMb === 1024, `${target} memory configuration changed.`);
      assert(endpoint.timeoutSeconds === 60, `${target} timeout configuration changed.`);
      assert(endpoint.cpu === undefined
        && JSON.stringify(endpoint.minInstances) === 'null'
        && JSON.stringify(endpoint.maxInstances) === 'null'
        && endpoint.concurrency === undefined,
      `${target} CPU or instance settings changed.`);
      assert(arraysEqual(secretKeys, ['GARMINAPI_WEBHOOK_SECRET']), `${target} secret bindings changed.`);
      assert(JSON.stringify(endpoint.httpsTrigger) === '{}'
        && endpoint.callableTrigger === undefined
        && endpoint.eventTrigger === undefined
        && endpoint.taskQueueTrigger === undefined
        && endpoint.scheduleTrigger === undefined,
      `${target} HTTP trigger or invoker configuration changed.`);
    } else if (CONNECTION_PROJECTION_TARGET_DOCUMENTS[target]) {
      assert(endpoint.availableMemoryMb === 512, `${target} memory configuration changed.`);
      assert(JSON.stringify(endpoint.timeoutSeconds) === 'null', `${target} timeout configuration changed.`);
      assert(endpoint.cpu === undefined
        && endpoint.concurrency === 10
        && endpoint.maxInstances === 20
        && JSON.stringify(endpoint.minInstances) === 'null',
      `${target} CPU or instance settings changed.`);
      assert(secretKeys.length === 0, `${target} secret bindings changed.`);
      assert(endpoint.eventTrigger?.eventType === 'google.cloud.firestore.document.v1.written'
        && endpoint.eventTrigger.eventFilterPathPatterns?.document === CONNECTION_PROJECTION_TARGET_DOCUMENTS[target]
        && endpoint.eventTrigger.retry === true,
      `${target} Firestore trigger or retry configuration changed.`);
      assert(endpoint.callableTrigger === undefined
        && endpoint.httpsTrigger === undefined
        && endpoint.taskQueueTrigger === undefined
        && endpoint.scheduleTrigger === undefined,
      `${target} trigger kind changed.`);
    } else if (INGESTION_TARGET_METADATA[target]) {
      const expected = INGESTION_TARGET_METADATA[target];
      assert(endpoint.availableMemoryMb === expected.memoryMb, `${target} memory configuration changed.`);
      assert(JSON.stringify(endpoint.timeoutSeconds) === JSON.stringify(expected.timeoutSeconds),
        `${target} timeout configuration changed.`);
      assert(endpoint.cpu === expected.cpu, `${target} CPU configuration changed.`);
      assert(JSON.stringify(endpoint.concurrency) === JSON.stringify(expected.concurrency ?? null)
        && JSON.stringify(endpoint.maxInstances) === JSON.stringify(expected.maxInstances ?? null)
        && JSON.stringify(endpoint.minInstances) === 'null',
      `${target} instance settings changed.`);
      assert(arraysEqual(secretKeys, [...(expected.secrets || [])].sort()), `${target} secret bindings changed.`);
      const triggers = {
        http: endpoint.httpsTrigger,
        event: endpoint.eventTrigger,
        task: endpoint.taskQueueTrigger,
        callable: endpoint.callableTrigger,
        schedule: endpoint.scheduleTrigger,
      };
      assert(arraysEqual(Object.entries(triggers)
        .filter(([, trigger]) => trigger !== undefined)
        .map(([kind]) => kind), [expected.trigger]),
      `${target} trigger kind changed.`);
      if (expected.trigger === 'http') {
        assert(JSON.stringify(endpoint.httpsTrigger) === '{}', `${target} HTTP invoker configuration changed.`);
      } else if (expected.trigger === 'event') {
        assert(endpoint.eventTrigger?.eventType === (expected.eventType ?? 'google.cloud.firestore.document.v1.created')
          && endpoint.eventTrigger.eventFilterPathPatterns?.document === expected.eventDocument
          && endpoint.eventTrigger.retry === (expected.eventRetry ?? true),
        `${target} Firestore trigger changed.`);
      } else {
        assert(endpoint.taskQueueTrigger?.retryConfig?.maxAttempts === 10
          && endpoint.taskQueueTrigger.retryConfig.maxDoublings === 4
          && JSON.stringify(endpoint.taskQueueTrigger.retryConfig.maxRetrySeconds) === 'null'
          && endpoint.taskQueueTrigger.retryConfig.minBackoffSeconds === 900
          && endpoint.taskQueueTrigger.retryConfig.maxBackoffSeconds === 14_400,
        `${target} task retry configuration changed.`);
        assert(JSON.stringify(endpoint.taskQueueTrigger?.rateLimits?.maxConcurrentDispatches)
          === JSON.stringify(expected.maxConcurrentDispatches ?? null)
          && JSON.stringify(endpoint.taskQueueTrigger?.rateLimits?.maxDispatchesPerSecond)
          === JSON.stringify(expected.maxDispatchesPerSecond ?? null),
        `${target} task rate limits changed.`);
      }
    } else if (GEN1_DISPATCHER_METADATA[target]) {
      const expected = GEN1_DISPATCHER_METADATA[target];
      assert(endpoint.availableMemoryMb === expected.memoryMb, `${target} memory configuration changed.`);
      assert(endpoint.timeoutSeconds === expected.timeoutSeconds, `${target} timeout configuration changed.`);
      assert(endpoint.cpu === undefined
        && endpoint.concurrency === undefined
        && JSON.stringify(endpoint.minInstances) === 'null'
        && endpoint.maxInstances === 1,
      `${target} CPU or instance settings changed.`);
      assert(secretKeys.length === 0, `${target} secret bindings changed.`);
      assert(endpoint.scheduleTrigger?.schedule === '*/30 * * * *'
        && JSON.stringify(endpoint.scheduleTrigger.timeZone) === 'null'
        && JSON.stringify(endpoint.scheduleTrigger.retryConfig) === JSON.stringify({
          retryCount: null, maxDoublings: null, maxRetryDuration: null,
          maxBackoffDuration: null, minBackoffDuration: null,
        }),
      `${target} schedule or retry configuration changed.`);
      assert(endpoint.callableTrigger === undefined
        && endpoint.httpsTrigger === undefined
        && endpoint.eventTrigger === undefined
        && endpoint.taskQueueTrigger === undefined,
      `${target} trigger kind changed.`);
    } else if (SCHEDULED_MAINTENANCE_TARGET_METADATA[target]) {
      const expected = SCHEDULED_MAINTENANCE_TARGET_METADATA[target];
      assert(endpoint.availableMemoryMb === 512, `${target} memory configuration changed.`);
      assert(endpoint.timeoutSeconds === expected.timeoutSeconds, `${target} timeout configuration changed.`);
      assert(endpoint.cpu === undefined, `${target} CPU configuration changed.`);
      assert(JSON.stringify(endpoint.concurrency) === 'null'
        && JSON.stringify(endpoint.minInstances) === 'null'
        && JSON.stringify(endpoint.maxInstances) === JSON.stringify(expected.maxInstances ?? null),
      `${target} instance settings changed.`);
      assert(arraysEqual(secretKeys, [...(expected.secrets || [])].sort()), `${target} secret bindings changed.`);
      assert(endpoint.scheduleTrigger?.schedule === 'every 30 minutes'
        && endpoint.scheduleTrigger.timeZone === undefined
        && JSON.stringify(endpoint.scheduleTrigger.retryConfig) === '{}',
      `${target} schedule or retry configuration changed.`);
      assert(endpoint.callableTrigger === undefined
        && endpoint.httpsTrigger === undefined
        && endpoint.eventTrigger === undefined
        && endpoint.taskQueueTrigger === undefined,
      `${target} trigger kind changed.`);
    } else if (target === 'reconcileTrainingPlanCleanup'
      || target === 'reconcileTrainingWorkoutExpiry' || target === 'reconcileTrainingBulkShift') {
      assert(endpoint.availableMemoryMb === 512, `${target} memory configuration changed.`);
      assert(endpoint.timeoutSeconds === 300, `${target} timeout configuration changed.`);
      assert(JSON.stringify(endpoint.concurrency) === 'null'
        && JSON.stringify(endpoint.maxInstances) === 'null'
        && JSON.stringify(endpoint.minInstances) === 'null',
      `${target} instance settings changed.`);
      assert(secretKeys.length === 0, `${target} secret bindings changed.`);
      const expectedSchedule = target === 'reconcileTrainingPlanCleanup' ? 'every 15 minutes'
        : target === 'reconcileTrainingWorkoutExpiry' ? '0 3 * * *' : 'every 5 minutes';
      assert(endpoint.scheduleTrigger?.schedule === expectedSchedule
        && endpoint.scheduleTrigger.timeZone === 'UTC'
        && JSON.stringify(endpoint.scheduleTrigger.retryConfig) === '{}',
      `${target} schedule changed.`);
    } else if (TRAINING_TARGET_METADATA[target]) {
      const expected = TRAINING_TARGET_METADATA[target];
      assert(endpoint.availableMemoryMb === expected.memoryMb, `${target} memory configuration changed.`);
      // Firebase's manifest uses ResetValue objects for unspecified numeric
      // options; their serialized value is null, which is what deployment sees.
      assert(JSON.stringify(endpoint.timeoutSeconds) === JSON.stringify(expected.timeoutSeconds),
        `${target} timeout configuration changed.`);
      assert(JSON.stringify(endpoint.concurrency) === JSON.stringify(expected.concurrency ?? null),
        `${target} concurrency changed.`);
      assert(JSON.stringify(endpoint.maxInstances) === JSON.stringify(expected.maxInstances ?? null),
        `${target} max instances changed.`);
      assert(JSON.stringify(endpoint.minInstances) === JSON.stringify(expected.minInstances ?? null),
        `${target} min instances changed.`);
      assert(arraysEqual(secretKeys, [...(expected.secrets || [])].sort()), `${target} secret bindings changed.`);
      if (expected.trigger === 'callable') {
        assert(endpoint.callableTrigger !== undefined, `${target} callable trigger changed.`);
      } else if (expected.trigger === 'event') {
        assert(
          endpoint.eventTrigger?.eventType === 'google.cloud.firestore.document.v1.written'
            && endpoint.eventTrigger.eventFilterPathPatterns?.document === expected.eventDocument
            && endpoint.eventTrigger.retry === true,
          `${target} Firestore trigger changed.`,
        );
      } else if (expected.trigger === 'schedule') {
        assert(endpoint.scheduleTrigger?.schedule === expected.schedule
          && endpoint.scheduleTrigger?.timeZone === undefined
          && JSON.stringify(endpoint.scheduleTrigger?.retryConfig) === '{}',
        `${target} schedule changed.`);
      } else {
        assert(endpoint.taskQueueTrigger?.retryConfig?.maxAttempts === 10
          && endpoint.taskQueueTrigger.retryConfig.maxDoublings === 4
          && JSON.stringify(endpoint.taskQueueTrigger.retryConfig.maxRetrySeconds) === 'null'
          && endpoint.taskQueueTrigger.retryConfig.minBackoffSeconds === 900
          && endpoint.taskQueueTrigger.retryConfig.maxBackoffSeconds === 14_400,
        `${target} task retry configuration changed.`);
        const expectedRateLimit = target === 'processTrainingDeliveryTask' ? 10 : null;
        assert(
          JSON.stringify(endpoint.taskQueueTrigger?.rateLimits?.maxConcurrentDispatches) === JSON.stringify(expectedRateLimit)
            && JSON.stringify(endpoint.taskQueueTrigger?.rateLimits?.maxDispatchesPerSecond) === JSON.stringify(expectedRateLimit),
          `${target} task rate limits changed.`,
        );
      }
    } else if (ADMIN_TARGET_METADATA[target]) {
      const expected = ADMIN_TARGET_METADATA[target];
      assert(endpoint.availableMemoryMb === expected.memoryMb, target + ' memory configuration changed.');
      assert(JSON.stringify(endpoint.timeoutSeconds) === JSON.stringify(expected.timeoutSeconds),
        target + ' timeout configuration changed.');
      assert(endpoint.cpu === undefined
        && JSON.stringify(endpoint.concurrency) === 'null'
        && JSON.stringify(endpoint.minInstances) === 'null'
        && JSON.stringify(endpoint.maxInstances) === 'null',
      target + ' CPU or instance settings changed.');
      assert(arraysEqual(secretKeys, [...(expected.secrets || [])].sort()), target + ' secret bindings changed.');
      if (expected.trigger === 'schedule') {
        assert(endpoint.scheduleTrigger?.schedule === '10 0 * * *'
          && endpoint.scheduleTrigger.timeZone === 'UTC'
          && endpoint.scheduleTrigger.retryConfig?.retryCount === 3
          && endpoint.scheduleTrigger.retryConfig?.maxRetrySeconds === 21_600
          && endpoint.scheduleTrigger.retryConfig?.minBackoffSeconds === 60
          && endpoint.scheduleTrigger.retryConfig?.maxBackoffSeconds === 3_600,
        target + ' schedule or retry configuration changed.');
      } else {
        assert(JSON.stringify(endpoint.callableTrigger) === '{}', target + ' callable trigger changed.');
      }
      assert(endpoint.httpsTrigger === undefined
        && endpoint.eventTrigger === undefined
        && endpoint.taskQueueTrigger === undefined
        && (expected.trigger === 'callable' || endpoint.callableTrigger === undefined)
        && (expected.trigger === 'schedule' || endpoint.scheduleTrigger === undefined),
      target + ' trigger kind changed.');
    } else if (MARKETING_TARGETS.has(target)) {
      const expectedMemory = target === 'trackMarketingDelivery' || target === 'marketingUnsubscribe'
        ? 256 : 512;
      assert(endpoint.availableMemoryMb === expectedMemory, `${target} memory configuration changed.`);
      const expectedSecrets = MARKETING_SECRET_TARGETS.has(target)
        ? ['MARKETING_UNSUBSCRIBE_SIGNING_KEY'] : [];
      assert(arraysEqual(secretKeys, expectedSecrets), `${target} secret bindings changed.`);
      if (target === 'trackMarketingDelivery') {
        assert(
          endpoint.eventTrigger?.eventType === 'google.cloud.firestore.document.v1.updated'
            && endpoint.eventTrigger.eventFilterPathPatterns?.document === 'mail/{mailId}'
            && endpoint.eventTrigger.retry === false,
          `${target} Firestore trigger changed.`,
        );
      } else if (target === 'dispatchMarketingCampaigns') {
        assert(
          endpoint.scheduleTrigger?.schedule === 'every 5 minutes'
            && endpoint.scheduleTrigger.timeZone === 'UTC',
          `${target} schedule changed.`,
        );
      } else if (target === 'marketingUnsubscribe') {
        assert(endpoint.httpsTrigger !== undefined, `${target} HTTP trigger changed.`);
      } else {
        assert(endpoint.callableTrigger !== undefined, `${target} callable trigger changed.`);
      }
    } else {
      assert(endpoint.availableMemoryMb === 512, `${target} is no longer configured at 512 MiB.`);
      assert(
        arraysEqual(secretKeys, ['SUUNTOAPP_CLIENT_ID', 'SUUNTOAPP_CLIENT_SECRET']),
        `${target} secret bindings changed.`,
      );
    }
  }

  console.log(
    `Entrypoint loading verified: ${discovery.exports.length} Firebase endpoints and ${OPTIMIZED_FUNCTION_TARGETS.length} isolated targets.`,
  );
}

if (process.argv[2] === '--probe') {
  probe(process.argv[3] || NO_TARGET);
} else {
  check().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
