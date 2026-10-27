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
