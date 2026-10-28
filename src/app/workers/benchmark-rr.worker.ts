/// <reference lib="webworker" />
// 23.5.0 exports analysis only through its parser-bearing root barrel. In a
// separate worker build that also emits unused FIT parser chunks. Import its
// pure implementation until Sports Lib offers an analysis-only public entry.
// The compiled-worker test verifies this pinned path against the public API.
import { analyzeRRIntervals } from '../../../node_modules/@sports-alliance/sports-lib/lib/esm/events/utilities/rr-analysis.js';
import type { BenchmarkRRAnalysisInput, BenchmarkRRWorkerResponse } from '../helpers/benchmark-rr.helper';

addEventListener('message', (event: MessageEvent<BenchmarkRRAnalysisInput>) => {
  let response: BenchmarkRRWorkerResponse;
  try {
    response = { analysis: analyzeRRIntervals(event.data.samples, event.data.durationMs) };
  } catch {
    response = { error: 'The recorded interval timing could not be analyzed.' };
  }
  postMessage(response);
});
