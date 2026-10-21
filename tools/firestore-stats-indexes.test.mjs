import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPreparation, checkReadiness, createRolloutPlan, statsIndexAllowlist, statsIndexStage, validateStatsIndexConfig } from './firestore-stats-indexes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(resolve(root, 'firestore.indexes.json'), 'utf8'));
const finalFixturePath = resolve(root, 'tools/fixtures/firestore-stats-indexes-final.json');
const finalFixture = JSON.parse(readFileSync(finalFixturePath, 'utf8'));
const stageParents = { prepare: [], 'events-exempt': ['events'], 'both-exempt': ['events', 'activities'] };
const project = 'demo-stats-indexes';
const database = '(default)';
const prefix = `projects/${project}/databases/${database}/collectionGroups/`;
const clone = value => structuredClone(value);
const ordered = ['ASCENDING', 'DESCENDING'].map(order => ({ order, queryScope: 'COLLECTION' }));
const allModes = [...ordered, { arrayConfig: 'CONTAINS', queryScope: 'COLLECTION' }];
const isTargetStat = field => ['events', 'activities'].includes(field.collectionGroup)
  && (field.fieldPath === 'stats' || field.fieldPath.startsWith('stats.'));

// Only the stats overrides are frozen in the fixture. Always use current composites and unrelated overrides.
function configForStage(stage) {
  return { ...clone(config), fieldOverrides: [
    ...config.fieldOverrides.filter(field => !isTargetStat(field)).map(clone),
    ...finalFixture.fieldOverrides.filter(field => field.fieldPath !== 'stats' || stageParents[stage].includes(field.collectionGroup)).map(clone),
  ] };
}

function plan(phase, state = snapshots()) {
  const stage = phase === 'prepare' ? 'prepare' : phase === 'enforce-events' ? 'events-exempt' : 'both-exempt';
  return createRolloutPlan(configForStage(stage), phase, project, database, state, stage);
}
// gcloud/Admin API indexes nest order/arrayConfig inside fields, unlike the config file.
const apiIndex = (mode, fieldPath) => {
  const { queryScope, ...ordering } = mode;
  return { queryScope, fields: [{ fieldPath, ...ordering }], state: 'READY' };
};

function snapshots(exemptParents = []) {
  return {
    fields: [
      { name: `${prefix}__default__/fields/*`, indexConfig: { indexes: allModes.map(mode => apiIndex(mode, '*')) } },
      ...statsIndexAllowlist.map(field => ({
        name: `${prefix}${field.collectionGroup}/fields/${field.fieldPath}`,
        indexConfig: { ancestorField: `${prefix}__default__/fields/*`, usesAncestorConfig: false,
          indexes: field.indexes.map(mode => apiIndex(mode, field.fieldPath)) },
      })),
      ...exemptParents.map(collectionGroup => ({
        name: `${prefix}${collectionGroup}/fields/stats`, indexConfig: { indexes: [], usesAncestorConfig: false },
      })),
    ],
    composites: config.indexes.filter(index => ['events', 'activities'].includes(index.collectionGroup)).map((index, i) => ({
      ...clone(index), collectionGroup: undefined, name: `${prefix}${index.collectionGroup}/indexes/fixture-${i}`, state: 'READY',
    })),
  };
}

test('the deployable configuration matches the committed rollout stage and audited child fields', () => {
  validateStatsIndexConfig(config);
  assert.deepEqual(config.fieldOverrides.filter(isTargetStat).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    configForStage(statsIndexStage).fieldOverrides.filter(isTargetStat).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  assert.deepEqual(statsIndexAllowlist.filter(field => field.collectionGroup === 'events').map(field => field.fieldPath), [
    'stats.`Activity Types`', 'stats.`Average Heart Rate`', 'stats.`Device Names`', 'stats.Ascent', 'stats.Descent',
    'stats.Distance', 'stats.Duration', 'stats.Energy', 'stats.PowerCurve', 'stats.Weight',
  ]);
  assert.deepEqual(statsIndexAllowlist.filter(field => field.collectionGroup === 'activities').map(field => field.fieldPath), ['stats.`VO2 Max`']);
});

test('preparation keeps both parents enabled; the complete policy is an unwired stats-only fixture', () => {
  const prepared = configForStage('prepare');
  assert.equal(prepared.fieldOverrides.filter(field => isTargetStat(field) && field.fieldPath === 'stats').length, 0);
  assert.deepEqual(Object.keys(finalFixture), ['fieldOverrides']);
  assert.equal(finalFixture.fieldOverrides.length, 13);
  assert(finalFixture.fieldOverrides.every(isTargetStat));
  validateStatsIndexConfig(configForStage('both-exempt'), 'both-exempt');
  const firebaseConfig = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8'));
  assert.equal(firebaseConfig.firestore.indexes, 'firestore.indexes.json');
  for (const name of readdirSync(root).filter(name => /^firebase(?:\..+)?\.json$/.test(name))) {
    const settings = JSON.parse(readFileSync(resolve(root, name), 'utf8'));
    for (const firestore of [settings.firestore].flat().filter(Boolean)) {
      if (firestore.indexes) assert.notEqual(resolve(root, firestore.indexes), finalFixturePath, name);
    }
  }
});

test('stage/config mismatches and activities-first rollout fail closed', () => {
  for (const stage of Object.keys(stageParents)) {
    validateStatsIndexConfig(configForStage(stage), stage);
    for (const other of Object.keys(stageParents).filter(other => other !== stage)) {
      assert.throws(() => validateStatsIndexConfig(configForStage(other), stage), /Unexpected|Incorrect/);
    }
  }
  for (const stage of ['unknown', '__proto__', null, {}]) {
    assert.throws(() => validateStatsIndexConfig(config, stage), /Unknown/);
  }
  const activitiesFirst = configForStage('prepare');
  activitiesFirst.fieldOverrides.push({ collectionGroup: 'activities', fieldPath: 'stats', indexes: [] });
  for (const stage of Object.keys(stageParents)) assert.throws(() => validateStatsIndexConfig(activitiesFirst, stage));
});

test('new and R-R stats remain unindexed by inheritance and cannot enter a composite accidentally', () => {
  const finalConfig = configForStage('both-exempt');
  for (const collectionGroup of ['events', 'activities']) {
    const parent = finalConfig.fieldOverrides.find(field => field.collectionGroup === collectionGroup && field.fieldPath === 'stats');
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
  const parent = configForStage('both-exempt');
  delete parent.fieldOverrides.find(field => field.fieldPath === 'stats').indexes;
  assert.throws(() => validateStatsIndexConfig(parent, 'both-exempt'), /Incorrect/);
});

test('phase one emits only explicit child updates preserving all existing array modes', () => {
  const before = clone(config);
  const prepared = plan('prepare');
  assert.equal(prepared.stage, 'prepare');
  assert.equal(prepared.commands.length, 11);
  for (const [i, command] of prepared.commands.entries()) {
    assert.deepEqual(command.slice(0, 6), ['gcloud', 'firestore', 'indexes', 'fields', 'update', statsIndexAllowlist[i].fieldPath]);
    assert(command.includes(`--project=${project}`));
    assert(command.includes('--database=(default)'));
    assert(!command.includes('--disable-indexes'));
    assert(!command.includes('--clear-exemption'));
    assert.equal(command.filter(arg => arg.startsWith('--index=')).length, statsIndexAllowlist[i].indexes.length);
  }
  for (const arrayField of ['stats.`Activity Types`', 'stats.`Device Names`', 'stats.PowerCurve']) {
    const command = prepared.commands.find(command => command[5] === arrayField);
    assert(command.includes('--index=array-config=CONTAINS'));
  }
  assert.deepEqual(config, before);
});

test('phase two is gated and affects one parent at a time; rollback restores inheritance only', () => {
  for (const group of ['events', 'activities']) {
    assert.throws(() => createRolloutPlan(config, `enforce-${group}`, project, database), /requires fresh/);
    const enforcement = plan(`enforce-${group}`, snapshots(group === 'activities' ? ['events'] : []));
    assert.equal(enforcement.commands.length, 1);
    assert.equal(enforcement.commands[0][5], 'stats');
    assert(enforcement.commands[0].includes(`--collection-group=${group}`));
    assert(enforcement.commands[0].includes('--disable-indexes'));
  }
  const rollback = createRolloutPlan(config, 'rollback', project, database, snapshots());
  assert.equal(rollback.commands.length, 2);
  assert(rollback.commands.every(command => command[5] === 'stats' && command.includes('--clear-exemption')));
});

test('preparation cannot plan enforcement and events-only cannot advance activities', () => {
  for (const group of ['events', 'activities']) {
    assert.throws(() => createRolloutPlan(configForStage('prepare'), `enforce-${group}`, project, database, snapshots(), 'prepare'), /not enabled/);
  }
  assert.throws(() => createRolloutPlan(configForStage('events-exempt'), 'enforce-activities', project, database, snapshots(['events']), 'events-exempt'), /not enabled/);
  for (const stage of ['events-exempt', 'both-exempt']) {
    assert.throws(() => createRolloutPlan(configForStage(stage), 'prepare', project, database, snapshots(), stage), /committed prepare/);
  }
});

test('activities enforcement requires completed events exemption; events-only preserves activities defaults', () => {
  assert.throws(() => plan('enforce-activities'), /events exemption first/);
  for (const change of [
    field => { field.indexConfig.usesAncestorConfig = true; },
    field => { field.indexConfig.reverting = true; },
    field => { field.indexConfig.indexes = allModes.map(mode => apiIndex(mode, 'stats')); },
    field => { delete field.indexConfig; },
  ]) {
    const state = snapshots(['events']);
    change(state.fields.at(-1));
    assert.throws(() => plan('enforce-activities', state));
  }
  const omittedEmptyArray = snapshots(['events']);
  delete omittedEmptyArray.fields.at(-1).indexConfig.indexes;
  plan('enforce-activities', omittedEmptyArray);
  plan('enforce-activities', snapshots(['events', 'activities']));
  plan('enforce-events', snapshots(['events']));
  assert.throws(() => plan('enforce-events', snapshots(['events', 'activities'])), /Activities parent drift/);
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
    assert.throws(() => plan('enforce-events', state));
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

test('unrelated index additions stay deployable in every stage; only enforcement waits for fresh READY composites', () => {
  const addition = { collectionGroup: 'events', queryScope: 'COLLECTION', fields: [
    { fieldPath: 'newOperationalField', order: 'ASCENDING' }, { fieldPath: 'startDate', order: 'DESCENDING' },
  ] };
  for (const stage of Object.keys(stageParents)) {
    const current = configForStage(stage);
    current.indexes.push(addition);
    current.fieldOverrides.push({ collectionGroup: 'unrelated', fieldPath: 'payload', indexes: [] });
    validateStatsIndexConfig(current, stage);
    const live = snapshots();
    assert.throws(() => checkReadiness(current, live.fields, live.composites, project, database, stage), /composite index drift/);
    live.composites.push({ ...clone(addition), collectionGroup: undefined, name: `${prefix}events/indexes/new-operational`, state: 'CREATING' });
    assert.throws(() => checkReadiness(current, live.fields, live.composites, project, database, stage), /unfinished build/);
    live.composites.at(-1).state = 'READY';
    checkReadiness(current, live.fields, live.composites, project, database, stage);
  }
});

test('explicit project/database and a known review-only phase are mandatory', () => {
  for (const [phase, target, db] of [['prepare', undefined, database], ['prepare', project, undefined], ['deploy', project, database],
    ['prepare', 'project;command', database], ['prepare', project, '../database']]) {
    assert.throws(() => createRolloutPlan(config, phase, target, db));
  }
});

test('preparation requires snapshots and blocks replacement of existing extra modes/scopes', () => {
  assert.throws(() => createRolloutPlan(config, 'prepare', project, database), /requires fresh/);
  assert.throws(() => createRolloutPlan(config, 'rollback', project, database), /requires fresh/);
  const baseline = snapshots();
  baseline.fields.splice(1);
  assert.equal(plan('prepare', baseline).commands.length, 11);
  const partial = snapshots();
  partial.fields[1].indexConfig.indexes.pop();
  checkPreparation(config, partial.fields, partial.composites, project, database);
  for (const mutate of [
    state => { state.fields[1].indexConfig.indexes.push({ ...apiIndex(allModes[0], statsIndexAllowlist[0].fieldPath), queryScope: 'COLLECTION_GROUP' }); },
    state => { state.fields[1].indexConfig.indexes[0].state = 'CREATING'; },
    state => { state.fields[2].indexConfig.indexes.push(apiIndex(allModes[2], statsIndexAllowlist[1].fieldPath)); },
    state => { state.fields.push({ name: `${prefix}events/fields/stats`, indexConfig: { indexes: [] } }); },
  ]) {
    const state = snapshots(); mutate(state);
    assert.throws(() => plan('prepare', state));
  }
});

test('collection wildcard and parent-mode drift block preparation, enforcement and rollback', () => {
  const wildcard = clone(config);
  wildcard.fieldOverrides.push({ collectionGroup: 'events', fieldPath: '*', indexes: [] });
  assert.throws(() => validateStatsIndexConfig(wildcard), /wildcard/);
  for (const mutate of [
    state => { state.fields.push({ name: `${prefix}events/fields/*`, indexConfig: { indexes: [] } }); },
    state => { state.fields.push({ name: `${prefix}activities/fields/stats`, indexConfig: { indexes: [apiIndex(ordered[0], 'stats')] } }); },
    state => { state.fields.push(clone(state.fields[0])); },
  ]) {
    for (const phase of ['prepare', 'enforce-events', 'enforce-activities', 'rollback']) {
      const state = snapshots(); mutate(state);
      assert.throws(() => plan(phase, state));
    }
  }
  const applied = snapshots();
  applied.fields.push({ name: `${prefix}events/fields/stats`, indexConfig: { indexes: [] } });
  plan('enforce-activities', applied);
  createRolloutPlan(config, 'rollback', project, database, applied);
});

test('CLI reads committed stages and fresh snapshots but only prints argv, even with no gcloud on PATH', t => {
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), 'qs-stats-index-test-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const tools = resolve(directory, 'tools');
  mkdirSync(tools);
  const script = resolve(tools, 'firestore-stats-indexes.mjs');
  writeFileSync(script, readFileSync(resolve(root, 'tools/firestore-stats-indexes.mjs')));
  const state = snapshots(['events']);
  const fields = resolve(directory, 'fields.json');
  const composites = resolve(directory, 'composites.json');
  writeFileSync(fields, JSON.stringify(state.fields));
  writeFileSync(composites, JSON.stringify(state.composites));
  const run = (...args) => spawnSync(process.execPath, [script, ...args],
    { encoding: 'utf8', cwd: directory, env: { ...process.env, PATH: directory } });
  for (const [stage, allowed, blocked] of [
    ['prepare', ['prepare', 'rollback'], ['enforce-events', 'enforce-activities']],
    ['events-exempt', ['enforce-events', 'rollback'], ['prepare', 'enforce-activities']],
    ['both-exempt', ['enforce-events', 'enforce-activities', 'rollback'], ['prepare']],
  ]) {
    writeFileSync(resolve(directory, 'firestore.indexes.json'), JSON.stringify(configForStage(stage)));
    writeFileSync(resolve(tools, 'firestore-stats-indexes.stage.json'), JSON.stringify({ stage }));
    const fieldsForStage = snapshots(stage === 'prepare' ? [] : ['events']).fields;
    writeFileSync(fields, JSON.stringify(fieldsForStage));
    for (const phase of allowed) {
      const planned = run(phase, project, database, fields, composites);
      assert.equal(planned.status, 0, planned.stderr);
      const result = JSON.parse(planned.stdout);
      assert.equal(result.stage, stage);
      assert.equal(result.commands.length, phase === 'prepare' ? 11 : phase === 'rollback' ? 2 : 1);
    }
    for (const phase of blocked) {
      const result = run(phase, project, database, fields, composites);
      assert.equal(result.status, 1, phase);
      assert.equal(result.stdout, '');
    }
    assert.equal(readFileSync(fields, 'utf8'), JSON.stringify(fieldsForStage));
  }
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
