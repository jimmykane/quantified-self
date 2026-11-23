import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

test('runs offline when the only Sync selection in the window is a repeat', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'qs-onboarding-report-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const start = Date.UTC(2026, 10, 16);
  const day = 86_400_000;
  const inputs = {
    'manifest.json': { cutover: start - day, from: start, until: start + day, asOf: start + 2 * day, events: 'events.json' },
    'events.json': [
      { uid: 'returning', name: 'onboarding_sync_selected', at: start - day },
      { uid: 'returning', name: 'onboarding_sync_selected', at: start },
      { uid: 'new-owner', name: 'onboarding_compare_selected', at: start },
      { uid: 'new-owner', name: 'comparison_result_opened', at: start + 50 },
    ],
  };
  for (const [name, value] of Object.entries(inputs)) await writeFile(join(dir, name), JSON.stringify(value));
  const cli = fileURLToPath(new URL('run.mjs', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [cli, join(dir, 'manifest.json')], {
    env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: '' },
  });
  const { flows } = JSON.parse(stdout);
  assert.equal(flows.sync.starters, 0);
  assert.equal(flows.compare.observed24hShare, 1);
  assert.equal(flows.compare.cancellationOrder, null);
  assert.doesNotMatch(stdout, /returning|new-owner/);
});
