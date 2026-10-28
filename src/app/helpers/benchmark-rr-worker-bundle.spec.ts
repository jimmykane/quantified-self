import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { analyzeRRIntervals } from '@sports-alliance/sports-lib';
import type { BenchmarkRRAnalysisInput, BenchmarkRRWorkerResponse } from './benchmark-rr.helper';

const requireBuildTool = createRequire(createRequire(import.meta.url).resolve('@angular/build/package.json'));
const { build } = requireBuildTool('esbuild') as typeof import('esbuild');
let bundle: Awaited<ReturnType<typeof build>>;

beforeAll(async () => {
  bundle = await build({
    entryPoints: ['src/app/workers/benchmark-rr.worker.ts'], bundle: true, splitting: true,
    format: 'esm', platform: 'browser', target: 'es2022', minify: true, metafile: true,
    tsconfig: 'src/tsconfig.app.json', outdir: '/tmp/qs-benchmark-rr-worker-test', write: false,
  });
});

function worker() {
  let receive!: (event: { data: BenchmarkRRAnalysisInput }) => void;
  const messages: BenchmarkRRWorkerResponse[] = [];
  runInNewContext(bundle.outputFiles![0].text, {
    addEventListener: (name: string, callback: typeof receive) => {
      expect(name).toBe('message'); receive = callback;
    },
    postMessage: (response: BenchmarkRRWorkerResponse) => messages.push(structuredClone(response)),
  }, { timeout: 5000 });
  return { send: (data: BenchmarkRRAnalysisInput) => receive({ data }), messages };
}

describe('compiled benchmark R–R worker', () => {
  it('emits one small pure-analysis worker without any parser or application runtime', () => {
    expect(bundle.outputFiles).toHaveLength(1);
    expect(bundle.outputFiles![0].contents.byteLength).toBeLessThan(15_000);
    expect(Object.keys(bundle.metafile!.inputs).filter(path =>
      /fit-file-parser|\/adapters\/|sports-lib\/lib\/esm\/index\.js$|@angular|firebase/.test(path))).toEqual([]);
  });

  it('matches the public Sports Lib analysis with irregular timing, invalid barriers and rolling windows', () => {
    let time = 0;
    const samples = Array.from({ length: 500 }, (_, index) => {
      const interval = 800 + Math.sin(index * .3) * 30;
      time += interval + (index === 250 ? 10_000 : 0);
      return { time, interval: index === 50 ? NaN : interval };
    });
    const input = { samples, durationMs: time + 1000 };
    const instance = worker(); instance.send(input);
    expect(instance.messages[0]).toStrictEqual(structuredClone({ analysis: analyzeRRIntervals(samples, input.durationMs) }));
    const response = instance.messages[0];
    if ('error' in response) throw new Error(response.error);
    expect(response.analysis!.beats.length).toBeGreaterThan(0);
    expect(response.analysis!.windows.some(window => window.dfaAlpha1 !== null)).toBe(true);
    expect(input.samples[50].interval).toBeNaN();
  });

  it('returns unavailable for an ineligible sample set', () => {
    const instance = worker(); instance.send({ samples: [], durationMs: 1000 });
    expect(instance.messages).toEqual([{ analysis: null }]);
  });

  it('sanitizes failures and can process the next request', () => {
    const instance = worker(); instance.send(null as unknown as BenchmarkRRAnalysisInput);
    expect(instance.messages[0]).toEqual({ error: 'The recorded interval timing could not be analyzed.' });
    instance.send({ samples: [{ time: 800, interval: 800 }], durationMs: 1000 });
    expect(instance.messages[1]).toHaveProperty('analysis');
  });
});
