import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countSlowerImports, planBatch, satisfiesNoSlowdown, simulate } from './suunto-history-windows.mjs';

test('an aggregate improvement cannot hide an individually slower import', () => {
  const before = { completionSeconds: 100, perImportSeconds: [10, 100] };
  const after = { completionSeconds: 90, perImportSeconds: [20, 90] };
  assert.equal(countSlowerImports(before, after), 1);
  assert.equal(satisfiesNoSlowdown([{ before, after }, { before, after: before }]), false);
  assert.equal(satisfiesNoSlowdown([{ before, after: before }]), true);
  assert.throws(() => countSlowerImports(before, { perImportSeconds: [90] }), /same imports/);
});

test('the baseline includes Health continuations while alignment preserves all feeds', () => {
  const before = simulate({ days: 30, batchSize: 0 });
  const after = simulate({ days: 30, batchSize: 4 });
  assert.equal(before.jobs, 4);
  assert.equal(before.attempts, 5);
  assert.equal(before.calls, 11); // Two Sleep calls plus three Health targets * three feeds.
  assert.equal(after.jobs, 4);
  assert.equal(after.attempts, 4);
  assert.equal(after.calls, 8);
  assert.equal(countSlowerImports(before, after), 0);
});

test('the candidate model includes the final millisecond and fractional-day tails', () => {
  for (const kind of ['sleep', 'health']) {
    const width = (kind === 'health' ? 26 : 28) * 86400000;
    for (const end of [1, width - 1, width, width + 1, 4 * width + 1]) {
      let cursor = 0;
      while (cursor < end) {
        const batch = planBatch(cursor, end, kind, 4);
        assert.ok(batch.children.length <= 4);
        for (const child of [...batch.children].reverse()) {
          assert.equal(child.start, cursor);
          assert.ok(child.end > child.start && child.end - child.start <= width);
          cursor = child.end;
        }
        assert.equal(cursor, batch.next);
      }
      assert.equal(cursor, end);
    }
  }
});

test('arrival delay is not counted as import latency and coverage survives adaptive retries', () => {
  const options = { days: 30.001, batchSize: 4, adaptiveDays: 6.5, retry: true, density: 1 };
  const immediate = simulate(options);
  const delayed = simulate({ ...options, arrivalSeconds: [600] });
  assert.deepEqual(delayed.perImportSeconds, immediate.perImportSeconds);
  assert.equal(delayed.completionSeconds, immediate.completionSeconds + 600);
  for (const result of [immediate, delayed]) {
    assert.equal(result.coverage[0].sleepMs, result.coverage[0].requestedMs);
    assert.equal(result.coverage[0].healthMs, result.coverage[0].requestedMs);
  }
  assert.throws(() => simulate({ ...options, arrivalSeconds: [-1] }), /arrival time/);
});

test('a short import arriving after bulk work starts remains part of the latency gate', () => {
  const options = { days: 365, imports: 4, importDays: [365, 365, 365, 30], slots: 4,
    arrivalSeconds: [0, 0, 0, 30], importDensities: [4, 1, 4, 1], foreground: true };
  const before = simulate({ ...options, batchSize: 0 });
  const after = simulate({ ...options, batchSize: 4 });
  assert.ok(after.perImportSeconds[3] > before.perImportSeconds[3]);
  assert.equal(satisfiesNoSlowdown([{ before, after }]), false);
  for (const result of [before, after]) for (const range of result.coverage) {
    assert.equal(range.sleepMs, range.requestedMs);
    assert.equal(range.healthMs, range.requestedMs);
  }
});
