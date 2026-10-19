import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkReadiness, createRolloutPlan, statsIndexAllowlist, validateStatsIndexConfig } from './firestore-stats-indexes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(resolve(root, 'firestore.indexes.json'), 'utf8'));
const project = 'demo-stats-indexes';
const database = '(default)';
const prefix = `projects/${project}/databases/${database}/collectionGroups/`;
const clone = value => structuredClone(value);
const ordered = ['ASCENDING', 'DESCENDING'].map(order => ({ order, queryScope: 'COLLECTION' }));
const allModes = [...ordered, { arrayConfig: 'CONTAINS', queryScope: 'COLLECTION' }];
// gcloud/Admin API indexes nest order/arrayConfig inside fields, unlike the config file.
const apiIndex = (mode, fieldPath) => {
  const { queryScope, ...ordering } = mode;
  return { queryScope, fields: [{ fieldPath, ...ordering }], state: 'READY' };
};

function snapshots() {
  return {
    fields: [
      { name: `${prefix}__default__/fields/*`, indexConfig: { indexes: allModes.map(mode => apiIndex(mode, '*')) } },
      ...statsIndexAllowlist.map(field => ({
        name: `${prefix}${field.collectionGroup}/fields/${field.fieldPath}`,
        indexConfig: { ancestorField: `${prefix}__default__/fields/*`, usesAncestorConfig: false,
          indexes: field.indexes.map(mode => apiIndex(mode, field.fieldPath)) },
      })),
    ],
    composites: config.indexes.filter(index => ['events', 'activities'].includes(index.collectionGroup)).map((index, i) => ({
      ...clone(index), collectionGroup: undefined, name: `${prefix}${index.collectionGroup}/indexes/fixture-${i}`, state: 'READY',
    })),
  };
}

test('the committed target exempts both stats parents with exactly the audited child fields', () => {
  validateStatsIndexConfig(config);
  assert.deepEqual(statsIndexAllowlist.filter(field => field.collectionGroup === 'events').map(field => field.fieldPath), [
    'stats.`Activity Types`', 'stats.`Average Heart Rate`', 'stats.`Device Names`', 'stats.Ascent', 'stats.Descent',
    'stats.Distance', 'stats.Duration', 'stats.Energy', 'stats.PowerCurve', 'stats.Weight',
  ]);
  assert.deepEqual(statsIndexAllowlist.filter(field => field.collectionGroup === 'activities').map(field => field.fieldPath), ['stats.`VO2 Max`']);
});

test('new and R-R stats remain unindexed by inheritance and cannot enter a composite accidentally', () => {
  for (const collectionGroup of ['events', 'activities']) {
    const parent = config.fieldOverrides.find(field => field.collectionGroup === collectionGroup && field.fieldPath === 'stats');
    assert.deepEqual(parent.indexes, []);
    for (const fieldPath of ['stats.`R-R RMSSD`', 'stats.`R-R Coverage`', 'stats.`R-R DFA Alpha1 Median`', 'stats.FutureMetric']) {
      const changed = clone(config);
      changed.fieldOverrides.push({ collectionGroup, fieldPath, indexes: ordered });
      assert.throws(() => validateStatsIndexConfig(changed), /Unexpected/);
      const composite = clone(config);
      composite.indexes.push({ collectionGroup, queryScope: 'COLLECTION', fields: [{ fieldPath, order: 'ASCENDING' }] });
      assert.throws(() => validateStatsIndexConfig(composite), /unapproved/);
    }
  }
});

test('missing, duplicate and inherited child modes fail closed', () => {
  const missing = clone(config);
  missing.fieldOverrides = missing.fieldOverrides.filter(field => field.fieldPath !== 'stats.`Activity Types`');
  assert.throws(() => validateStatsIndexConfig(missing), /Unexpected/);
  const duplicate = clone(config);
  duplicate.fieldOverrides.push(clone(statsIndexAllowlist[0]));
  assert.throws(() => validateStatsIndexConfig(duplicate), /Unexpected/);
  const modesMissing = clone(config);
  modesMissing.fieldOverrides.find(field => field.fieldPath === 'stats.`Activity Types`').indexes = ordered;
  assert.throws(() => validateStatsIndexConfig(modesMissing), /Incorrect/);
  const parent = clone(config);
  delete parent.fieldOverrides.find(field => field.fieldPath === 'stats').indexes;
  assert.throws(() => validateStatsIndexConfig(parent), /Incorrect/);
});

test('phase one emits only explicit child updates preserving all existing array modes', () => {
  const before = clone(config);
  const plan = createRolloutPlan(config, 'prepare', project, database);
  assert.equal(plan.commands.length, 11);
  for (const [i, command] of plan.commands.entries()) {
    assert.deepEqual(command.slice(0, 6), ['gcloud', 'firestore', 'indexes', 'fields', 'update', statsIndexAllowlist[i].fieldPath]);
    assert(command.includes(`--project=${project}`));
    assert(command.includes('--database=(default)'));
    assert(!command.includes('--disable-indexes'));
    assert(!command.includes('--clear-exemption'));
    assert.equal(command.filter(arg => arg.startsWith('--index=')).length, statsIndexAllowlist[i].indexes.length);
  }
  for (const arrayField of ['stats.`Activity Types`', 'stats.`Device Names`', 'stats.PowerCurve']) {
    const command = plan.commands.find(command => command[5] === arrayField);
    assert(command.includes('--index=array-config=CONTAINS'));
  }
  assert.deepEqual(config, before);
});

test('phase two is gated and affects one parent at a time; rollback restores inheritance only', () => {
  for (const group of ['events', 'activities']) {
    assert.throws(() => createRolloutPlan(config, `enforce-${group}`, project, database), /requires fresh/);
    const plan = createRolloutPlan(config, `enforce-${group}`, project, database, snapshots());
    assert.equal(plan.commands.length, 1);
    assert.equal(plan.commands[0][5], 'stats');
    assert(plan.commands[0].includes(`--collection-group=${group}`));
    assert(plan.commands[0].includes('--disable-indexes'));
  }
  const rollback = createRolloutPlan(config, 'rollback', project, database);
  assert.equal(rollback.commands.length, 2);
  assert(rollback.commands.every(command => command[5] === 'stats' && command.includes('--clear-exemption')));
});

test('only fully built explicit configurations pass; omitted protobuf false is accepted', () => {
  const state = snapshots();
  delete state.fields[1].indexConfig.usesAncestorConfig;
  checkReadiness(config, state.fields, state.composites, project, database);
  for (const change of [
    field => { field.indexConfig.usesAncestorConfig = true; },
    field => { field.indexConfig.reverting = true; },
    field => { field.indexConfig.indexes[0].state = 'CREATING'; },
    field => { field.indexConfig.indexes[0].state = 'NEEDS_REPAIR'; },
    field => { field.indexConfig.indexes.pop(); },
  ]) {
    const broken = snapshots();
    change(broken.fields[1]);
    assert.throws(() => checkReadiness(config, broken.fields, broken.composites, project, database), /not READY|reverting/);
  }
  const missing = snapshots();
  missing.fields.splice(1, 1);
  assert.throws(() => checkReadiness(config, missing.fields, missing.composites, project, database), /not READY/);
});

test('wrong project/database, defaults, extra stats overrides and composite drift block enforcement', () => {
  const mutations = [
    state => { state.fields[0].name = state.fields[0].name.replace(project, 'other-project'); },
    state => { state.composites[0].name = state.composites[0].name.replace('(default)', 'other-db'); },
    state => { state.fields[0].indexConfig.indexes.pop(); },
    state => { state.fields[1].indexConfig.indexes[0].fields[0].fieldPath = 'wrongField'; },
    state => { state.fields[1].indexConfig.indexes[0].fields.push({ fieldPath: '__name__', order: 'ASCENDING' }); },
    state => { state.fields[1].indexConfig.indexes[0] = { ...ordered[0], state: 'READY' }; },
    state => { state.fields.push({ name: `${prefix}events/fields/stats.Unreviewed`, indexConfig: { indexes: [] } }); },
    state => { state.composites.pop(); },
    state => { state.composites[0].state = 'CREATING'; },
    state => { state.composites[0].fields[0].fieldPath = 'changed'; },
    state => { state.composites.push(clone(state.composites[0])); },
  ];
  for (const mutate of mutations) {
    const state = snapshots();
    mutate(state);
    assert.throws(() => createRolloutPlan(config, 'enforce-events', project, database, state));
  }
});

test('snapshot JSON object/array ordering and unrelated collection settings do not change the gate', () => {
  const state = snapshots();
  state.fields.reverse();
  for (const field of state.fields) field.indexConfig.indexes.reverse();
  state.composites.reverse();
  for (const index of state.composites) index.fields = index.fields.map(field => Object.fromEntries(Object.entries(field).reverse()));
  state.fields.push({ name: `${prefix}unrelated/fields/privatePayload`, indexConfig: { indexes: [] } });
  state.composites.push({ name: `${prefix}unrelated/indexes/other`, fields: [], state: 'CREATING' });
  checkReadiness(config, state.fields, state.composites, project, database);
});

test('explicit project/database and a known review-only phase are mandatory', () => {
  for (const [phase, target, db] of [['prepare', undefined, database], ['prepare', project, undefined], ['deploy', project, database],
    ['prepare', 'project;command', database], ['prepare', project, '../database']]) {
    assert.throws(() => createRolloutPlan(config, phase, target, db));
  }
});

test('CLI reads readiness snapshots but only prints reviewable argv, even with no gcloud on PATH', t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'qs-stats-index-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const state = snapshots();
  const fields = resolve(directory, 'fields.json');
  const composites = resolve(directory, 'composites.json');
  writeFileSync(fields, JSON.stringify(state.fields));
  writeFileSync(composites, JSON.stringify(state.composites));
  const run = (...args) => spawnSync(process.execPath, [resolve(root, 'tools/firestore-stats-indexes.mjs'), ...args],
    { encoding: 'utf8', cwd: directory, env: { ...process.env, PATH: directory } });
  const result = run('enforce-events', project, database, fields, composites);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).commands.length, 1);
  assert.equal(readFileSync(fields, 'utf8'), JSON.stringify(state.fields));
  for (const args of [[], ['deploy', project, database], ['enforce-events', project, database],
    ['prepare', project, database, 'extra']]) {
    const failed = run(...args);
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, '');
  }
});

test('the mandatory CI job runs the policy and rollout tests', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/_run-tests.yml'), 'utf8');
  const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts;
  assert.equal(scripts['test:stats-indexes'], 'node --test tools/firestore-stats-indexes.test.mjs');
  assert.match(workflow.split('  functions_tests:')[0], /run: npm run test:stats-indexes/);
});
