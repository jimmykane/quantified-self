/** Offline scheduling stress model, not a cloud/provider wall-clock benchmark.
 * Run: node tools/benchmarks/suunto-history-windows.mjs
 * Baseline mirrors 30-day parents -> 28-day children -> 26-day
 * Health continuations. Candidate uses exclusive contiguous 26/28-day targets.
 * All three Health feeds, padding, learned response splits and minute child waits
 * remain. FIFO worker slots are shared with synthetic foreground traffic.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const DAY = 86_400_000;
// --compiled exercises the production planner after the Functions build.
const compiled = process.argv.includes('--compiled')
  ? createRequire(import.meta.url)('../../functions/lib/functions/src/suunto/history-windows.js') : null;
export function planBatch(start, endExclusive, kind, batchSize) {
  const width = (compiled ? compiled.suuntoHistoryWindowDays(kind) : kind === 'health' ? 26 : 28) * DAY;
  const parentEnd = compiled && batchSize
    ? compiled.suuntoHistoryBatchRange(start, endExclusive - 1, kind, width / DAY * batchSize).endMs
    : Math.min(endExclusive, start + (batchSize ? width * batchSize : 30 * DAY));
  // Normalize the legacy sub-second boundary gap to equal covered work.
  const childEnd = parentEnd;
  const children = [];
  for (let cursor = start; cursor < childEnd; cursor += batchSize ? width : 28 * DAY) {
    children.push({ start: cursor, end: Math.min(childEnd, cursor + (batchSize ? width : 28 * DAY)) });
  }
  return { children: children.reverse(), next: parentEnd };
}
export function simulate({ days, batchSize, slots = 8, imports = 1, importDays, initialBacklog = 0, density = 0,
  adaptiveDays = 26, retry = false, foreground = false }) {
  let now = 0, sequence = 0, coordinatorFree = 0;
  const events = [], pending = [], running = new Set();
  const metrics = { parents: 0, admissions: 0, jobs: 0, attempts: 0, calls: 0, maxChildren: 0, foregroundMaxWait: 0 };
  const runs = Array.from({ length: imports }, (_, index) => ({ days: importDays?.[index] ?? days, cursor: 0, kind: 'sleep', children: [], done: false, retried: false, completed: 0, coverage: { sleep: [], health: [] } }));
  const schedule = (at, work) => { events.push({ at, work, sequence: sequence++ }); };
  const enqueue = job => { pending.push({ ...job, queuedAt: now }); };
  for (let i = 0; i < initialBacklog; i++) enqueue({ background: true, duration: 10 });
  const dispatch = () => {
    while (pending.length && running.size < slots) {
      const job = pending.shift(); running.add(job);
      if (job.background) {
        if (job.foreground) metrics.foregroundMaxWait = Math.max(metrics.foregroundMaxWait, now - job.queuedAt);
        schedule(now + job.duration, () => running.delete(job)); continue;
      }
      metrics.attempts++;
      let width = Math.min(job.end - job.cursor, job.learned * DAY), splits = 0;
      while (job.kind === 'health' && width > adaptiveDays * DAY) { width = Math.floor(width / 2); splits++; }
      const failed = retry && !job.run.retried && job.kind === 'health' && job.cursor <= 20 * DAY && job.cursor + width > 20 * DAY;
      if (failed) job.run.retried = true;
      const calls = job.kind === 'health' ? (failed ? 1 : 3) + splits : 1;
      metrics.calls += calls;
      const duration = 1 + calls * 0.5 + (width / DAY) * density;
      schedule(now + duration, () => {
        running.delete(job);
        if (failed) { schedule(now + 900, () => enqueue(job)); return; }
        job.run.coverage[job.kind].push([job.cursor, job.cursor + width]);
        job.cursor += width;
        job.learned = width / DAY;
        if (job.cursor < job.end) enqueue(job);
        else job.ref.done = true;
      });
    }
  };
  const parent = run => {
    if (run.done) return;
    if (now < coordinatorFree) { schedule(coordinatorFree, () => parent(run)); return; }
    coordinatorFree = now + 1; metrics.parents++;
    if (run.children.some(child => !child.done)) { schedule(now + 60, () => parent(run)); return; }
    if (run.cursor >= run.days * DAY) {
      if (run.kind === 'health') { run.done = true; run.completed = now; return; }
      run.kind = 'health'; run.cursor = 0;
      schedule(now + 2, () => parent(run)); return;
    }
    // Same admission stop as production: leave half the 1000-task budget free.
    if (pending.length + running.size >= 500) { schedule(now + 60, () => parent(run)); return; }
    const batch = planBatch(run.cursor, run.days * DAY, run.kind, batchSize);
    metrics.admissions++; metrics.maxChildren = Math.max(metrics.maxChildren, batch.children.length);
    run.children = batch.children.map(range => {
      const ref = { done: false }; const job = { ...range, cursor: range.start, learned: run.kind === 'health' ? 26 : 28, kind: run.kind, run, ref };
      enqueue(job);
      metrics.jobs++; return ref;
    });
    run.cursor = batch.next;
    schedule(now + 60, () => parent(run));
  };
  runs.forEach(run => schedule(0, () => parent(run)));
  const addForeground = () => {
    if (runs.every(run => run.done)) return;
    enqueue({ background: true, foreground: true, duration: 3 });
    schedule(now + 10, addForeground);
  };
  if (foreground) schedule(0, addForeground);
  dispatch();
  let ticks = 0;
  while (!runs.every(run => run.done)) {
    assert.ok(++ticks < 2_000_000, 'bounded simulation');
    events.sort((a, b) => a.at - b.at || a.sequence - b.sequence);
    const event = events.shift(); assert.ok(event, 'unfinished imports must stay reachable');
    now = event.at; event.work(); dispatch();
  }
  if (batchSize) for (const run of runs) for (const kind of ['sleep', 'health']) {
    const intervals = run.coverage[kind].sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const [start, end] of intervals) { assert.equal(start, cursor, 'no missing or repeated target interval'); cursor = end; }
    assert.equal(cursor, run.days * DAY, 'complete inclusive selected range');
  }
  return { ...metrics, completionSeconds: Math.max(...runs.map(run => run.completed)), perImportSeconds: runs.map(run => run.completed) };
}
export function stress() {
  const scenarios = [
    { name: 'empty', days: 9795.8575 },
    { name: 'dense', days: 9795.8575, density: 4 },
    { name: 'adaptive', days: 9795.8575, density: 1, adaptiveDays: 6.5 },
    { name: 'retry', days: 365, retry: true },
    { name: 'shared-queue', days: 365, imports: 8, slots: 4, foreground: true, density: 4 },
    { name: 'contended', days: 730, imports: 8, slots: 4, initialBacklog: 550, foreground: true, density: 1 },
  ];
  const rows = scenarios.map(scenario => {
    const before = simulate({ ...scenario, batchSize: 0 });
    const after = simulate({ ...scenario, batchSize: 4 });
    assert.ok(after.completionSeconds <= before.completionSeconds, `${scenario.name}: import latency regression`);
    assert.ok(after.calls <= before.calls, `${scenario.name}: provider call regression`);
    assert.ok(after.maxChildren <= 4);
    return { scenario: scenario.name, before, after };
  });
  let comparisons = 0;
  for (const days of [0.001, 1, 26, 28, 30, 31, 60, 90, 104, 112, 365, 730]) {
    for (const slots of [1, 2, 4, 16, 80]) for (const density of [0, 1, 4]) for (const adaptiveDays of [26, 13, 6.5]) {
      const options = { days, slots, density, adaptiveDays };
      const before = simulate({ ...options, batchSize: 0 });
      const after = simulate({ ...options, batchSize: 4 });
      assert.ok(after.completionSeconds <= before.completionSeconds, `latency: ${JSON.stringify(options)} ${before.completionSeconds} -> ${after.completionSeconds}`);
      comparisons++;
    }
  }
  const contentionChecks = [4, 16, 80].map(slots => {
    const options = { days: 365, importDays: [365, 365, 365, 365, 365, 365, 365, 30], imports: 8, slots, foreground: true, density: 4 };
    const before = simulate({ ...options, batchSize: 0 });
    const after = simulate({ ...options, batchSize: 4 });
    return { slots, before, after, slowerImports: after.perImportSeconds.filter((time, i) => time > before.perImportSeconds[i]).length };
  });
  return { noSlowdownSatisfied: contentionChecks.every(row => row.slowerImports === 0), contentionChecks, assumptions: 'Virtual time; FIFO fixed worker slots; 1s serialized coordinator; 60s child polling; all Health feeds; response splits; 900s transient backoff. Equal coverage (legacy sub-second gaps normalized); no live speed or euro-cost claim.', comparisons, rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = stress();
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes('--require-no-slowdown') && !result.noSlowdownSatisfied) process.exitCode = 1;
}
