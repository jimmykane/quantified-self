import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions } from './operate.mjs';
test('operator defaults to dry-run and requires exact scope and execution confirmation', () => {
  assert.equal(parseOptions(['--project=demo-stripe-billing', '--local', '--catalog']).execute, undefined);
  for (const args of [[], ['--project=production', '--local', '--catalog'], ['--project=production', '--catalog', '--execute'],
    ['--project=production', '--catalog', '--event=evt_fixture'], ['--project=production', '--recover'],
    ['--project=production', '--event=invalid']]) assert.throws(() => parseOptions(args));
  assert.equal(parseOptions(['--project=production', '--catalog', '--execute', '--confirm-project=production']).execute, true);
});
