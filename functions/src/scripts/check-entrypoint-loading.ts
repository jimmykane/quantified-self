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
const EXPECTED_FULL_EXPORT_COUNT = 165;
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
  entryPoint?: string;
  secretEnvironmentVariables?: Array<{ key?: string }>;
  callableTrigger?: unknown;
  scheduleTrigger?: { schedule?: string; timeZone?: string };
  eventTrigger?: {
    eventType?: string;
    eventFilterPathPatterns?: { document?: string };
    retry?: boolean;
  };
  httpsTrigger?: unknown;
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
  const forbiddenModules = normalizedModules.filter(path => {
    if (
      path.includes('/node_modules/@genkit-ai/')
      || path.includes('/node_modules/genkit/')
      || path.includes('/node_modules/@google-cloud/bigquery/')
      || path.includes('/lib/functions/src/mcp/')
    ) return true;
    if (!path.includes('/lib/functions/src/admin/')) return false;
    return !marketingTarget || !(
      path.includes('/lib/functions/src/admin/marketing/')
      || path.endsWith('/lib/functions/src/admin/shared/subscription.constants.js')
    );
  });

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
  const catalogProjection = stack.endpoints.projectEventTagCatalog;
  assert(
    catalogProjection?.platform === 'gcfv2'
      && arraysEqual(catalogProjection.region || [], ['europe-west2'])
      && catalogProjection.eventTrigger?.eventType === 'google.cloud.firestore.document.v1.written'
      && catalogProjection.eventTrigger.eventFilterPathPatterns?.document === 'users/{uid}/events/{eventId}'
      && catalogProjection.eventTrigger.retry === true,
    'Event tag catalog projection metadata changed.',
  );

  const firstGenerationEndpoint = Object.entries(stack.endpoints)
    .find(([, endpoint]) => endpoint.platform === 'gcfv1');
  assert(firstGenerationEndpoint, 'Firebase manifest no longer contains a Gen 1 fallback target.');
  const firstGeneration = runProbe(firstGenerationEndpoint[0]);
  assert(
    firstGeneration.matchesFullEntrypoint
      && arraysEqual(discovery.exports, firstGeneration.exports),
    `${firstGenerationEndpoint[0]} did not retain the complete Gen 1 entrypoint fallback.`,
  );

  for (const target of OPTIMIZED_FUNCTION_TARGETS) {
    const endpoint = stack.endpoints[target];
    assert(endpoint?.platform === 'gcfv2', `${target} is no longer a Gen 2 endpoint.`);
    assert(endpoint.entryPoint === target, `${target} entrypoint metadata changed.`);
    assert(
      arraysEqual(endpoint.region || [], ['europe-west2']),
      `${target} region metadata changed.`,
    );
    const secretKeys = (endpoint.secretEnvironmentVariables || [])
      .map(secret => secret.key || '')
      .sort();
    if (MARKETING_TARGETS.has(target)) {
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
