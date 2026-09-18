import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const NO_TARGET = '__NO_TARGET__';
const DEFAULT_RUNS = 5;

interface FunctionTargetLoaderModule {
  OPTIMIZED_FUNCTION_TARGETS: readonly string[];
}

interface ProbeResult {
  target: string | null;
  elapsedMs: number;
  rssAfterMiB: number;
  rssDeltaMiB: number;
  heapUsedMiB: number;
  loadedModuleCount: number;
  exportCount: number;
}

interface Summary {
  minimum: number;
  median: number;
  maximum: number;
}

function summarize(values: number[]): Summary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    minimum: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    maximum: sorted[sorted.length - 1],
  };
}

function probe(targetArgument: string): void {
  if (targetArgument === NO_TARGET) delete process.env.FUNCTION_TARGET;

  const loadedBefore = new Set(Object.keys(require.cache));
  const memoryBefore = process.memoryUsage();
  const startedAt = process.hrtime.bigint();
  const entrypoint = module.require(resolve(__dirname, '..', 'index')) as Record<string, unknown>;
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const exposedGlobal = global as typeof globalThis & { gc?: () => void };
  exposedGlobal.gc?.();
  const memoryAfter = process.memoryUsage();
  const loadedModuleCount = Object.keys(require.cache)
    .filter(path => !loadedBefore.has(path))
    .length;

  const result: ProbeResult = {
    target: process.env.FUNCTION_TARGET?.trim() || null,
    elapsedMs,
    rssAfterMiB: memoryAfter.rss / 1048576,
    rssDeltaMiB: (memoryAfter.rss - memoryBefore.rss) / 1048576,
    heapUsedMiB: memoryAfter.heapUsed / 1048576,
    loadedModuleCount,
    exportCount: Object.keys(entrypoint).length,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function runProbe(target: string): ProbeResult {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GCLOUD_PROJECT: process.env.GCLOUD_PROJECT || 'quantified-self-io',
  };
  if (target === NO_TARGET) {
    delete env.FUNCTION_TARGET;
  } else {
    env.FUNCTION_TARGET = target;
  }
  const child = spawnSync(process.execPath, ['--expose-gc', __filename, '--probe', target], {
    cwd: resolve(__dirname, '..', '..', '..', '..'),
    env,
    encoding: 'utf8',
  });
  if (child.status !== 0) {
    throw new Error(`Entrypoint benchmark failed for ${target}: ${child.stderr || child.stdout}`);
  }
  return JSON.parse(child.stdout.trim()) as ProbeResult;
}

function benchmarkTargets(): readonly string[] {
  // Load the production target list only in the parent process. Loading it in
  // probe mode would exclude the router itself from startup measurements.
  const targetLoader = module.require(
    resolve(__dirname, '..', 'function-target-loader'),
  ) as FunctionTargetLoaderModule;
  return [NO_TARGET, ...targetLoader.OPTIMIZED_FUNCTION_TARGETS];
}

function benchmark(): void {
  const requestedRuns = Number.parseInt(process.env.ENTRYPOINT_BENCHMARK_RUNS || '', 10);
  const runs = Number.isFinite(requestedRuns) && requestedRuns > 0 ? requestedRuns : DEFAULT_RUNS;
  const scenarios = benchmarkTargets().map(target => {
    const samples = Array.from({ length: runs }, () => runProbe(target));
    return {
      target: target === NO_TARGET ? null : target,
      runs,
      exportCount: samples[0].exportCount,
      elapsedMs: summarize(samples.map(sample => sample.elapsedMs)),
      rssAfterMiB: summarize(samples.map(sample => sample.rssAfterMiB)),
      rssDeltaMiB: summarize(samples.map(sample => sample.rssDeltaMiB)),
      heapUsedMiB: summarize(samples.map(sample => sample.heapUsedMiB)),
      loadedModuleCount: summarize(samples.map(sample => sample.loadedModuleCount)),
    };
  });

  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(),
    node: process.version,
    scenarios,
  }, null, 2));
}

if (process.argv[2] === '--probe') {
  probe(process.argv[3] || NO_TARGET);
} else {
  benchmark();
}
