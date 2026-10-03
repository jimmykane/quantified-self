import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  loadOptimizedFunctionTarget,
  OPTIMIZED_FUNCTION_TARGETS,
  resolveRuntimeFunctionTarget,
} from '../function-target-loader';

const NO_TARGET = '__NO_TARGET__';
// Exercise a property inherited from Object.prototype so the fallback check
// also guards against accidental prototype-based routing.
const UNKNOWN_TARGET = 'toString';
const EXPECTED_FULL_EXPORT_COUNT = 168;
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
  const assistantProposalTarget = runtimeTarget === 'applyAssistantTrainingProposal';
  const derivedRefreshTarget = runtimeTarget === 'ensureDerivedMetrics';
  const forbiddenModules = normalizedModules.filter(path => {
    if (path.endsWith('/lib/functions/src/full-entrypoint.js')) return true;
    if (
      (path.includes('/node_modules/@genkit-ai/') && !assistantProposalTarget)
      || (path.includes('/node_modules/genkit/') && !assistantProposalTarget)
      || path.includes('/node_modules/@google-cloud/bigquery/')
      || (path.includes('/lib/functions/src/mcp/') && !assistantProposalTarget && !derivedRefreshTarget)
    ) return true;
    if (!path.includes('/lib/functions/src/admin/')) return false;
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

  const unknown = runProbe(UNKNOWN_TARGET);
  assert(unknown.matchesFullEntrypoint, 'An unknown runtime target did not use the complete entrypoint.');
  assert(
    arraysEqual(discovery.exports, unknown.exports),
    'Unknown-target exports differ from discovery exports.',
  );

  const canaryTarget = OPTIMIZED_FUNCTION_TARGETS[0];
  assert(canaryTarget, 'The optimized target registry is empty.');
  for (const target of Object.keys(TRAINING_TARGET_METADATA)) {
    assert(OPTIMIZED_FUNCTION_TARGETS.includes(target), `${target} is missing its isolated loader.`);
  }
  for (const discoveryMode of ['control-api', 'manifest-output'] as const) {
    const guardedDiscovery = runProbe(canaryTarget, discoveryMode);
    assert(
      guardedDiscovery.matchesFullEntrypoint
        && arraysEqual(discovery.exports, guardedDiscovery.exports),
      `Firebase ${discoveryMode} discovery honored an inherited FUNCTION_TARGET.`,
    );
  }

  for (const target of OPTIMIZED_FUNCTION_TARGETS) {
    const optimized = runProbe(target);
    assert(
      arraysEqual(optimized.exports, [target]),
      `${target} exposed unexpected exports: ${optimized.exports.join(', ')}`,
    );
    assert(optimized.preservesHandlerIdentity, `${target} did not preserve its Firebase handler object.`);
    assert(optimized.matchesFullEntrypoint, `${target} differs from the full-entrypoint handler.`);
    assert(
      optimized.forbiddenModules.length === 0,
      `${target} loaded unrelated modules: ${optimized.forbiddenModules.join(', ')}`,
    );
  }

  const stack = await loadFirebaseManifest();
  const endpointNames = Object.keys(stack.endpoints).sort();
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
    const expectedPlatform = target === 'receiveSuunto247Data' ? 'gcfv1' : 'gcfv2';
    assert(endpoint?.platform === expectedPlatform, `${target} runtime generation changed.`);
    assert(endpoint.entryPoint === target, `${target} entrypoint metadata changed.`);
    assert(
      arraysEqual(endpoint.region || [], ['europe-west2']),
      `${target} region metadata changed.`,
    );
    const secretKeys = (endpoint.secretEnvironmentVariables || [])
      .map(secret => secret.key || '')
      .sort();
    if (target === 'receiveSuunto247Data') {
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
