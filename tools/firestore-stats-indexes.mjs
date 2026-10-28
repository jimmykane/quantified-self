import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const collectionScope = mode => ({ ...mode, queryScope: 'COLLECTION' });
const ordered = [{ order: 'ASCENDING' }, { order: 'DESCENDING' }].map(collectionScope);
const array = [...ordered, collectionScope({ arrayConfig: 'CONTAINS' })];
const stageParents = {
  prepare: [],
  'events-exempt': ['events'],
  'both-exempt': ['events', 'activities'],
};
export const statsIndexStage = JSON.parse(readFileSync(resolve(root, 'tools/firestore-stats-indexes.stage.json'), 'utf8')).stage;

// Query dependencies and conservative legacy compatibility, not a metric catalog.
// See docs/firestore-stats-indexes.md before changing this list or its modes.
export const statsIndexAllowlist = [
  ['events', 'stats.`Activity Types`', array],
  ['events', 'stats.`Average Heart Rate`', ordered],
  ['events', 'stats.`Device Names`', array],
  ['events', 'stats.Ascent', ordered],
  ['events', 'stats.Descent', ordered],
  ['events', 'stats.Distance', ordered],
  ['events', 'stats.Duration', ordered],
  ['events', 'stats.Energy', ordered],
  ['events', 'stats.PowerCurve', array],
  ['events', 'stats.Weight', ordered],
  ['activities', 'stats.`VO2 Max`', ordered],
].map(([collectionGroup, fieldPath, indexes]) => ({ collectionGroup, fieldPath, indexes }));

const isStats = path => path === 'stats' || path.startsWith('stats.');
const isTarget = group => group === 'events' || group === 'activities';
const key = field => `${field.collectionGroup}/${field.fieldPath}`;
const modes = indexes => (indexes || []).map(index => JSON.stringify({
  queryScope: index.queryScope,
  ...(index.order ? { order: index.order } : {}),
  ...(index.arrayConfig ? { arrayConfig: index.arrayConfig } : {}),
})).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };

function apiModes(indexes, fieldPath) {
  requireCondition(Array.isArray(indexes) && indexes.every(index => index.fields?.length === 1
    && index.fields[0].fieldPath === fieldPath), `Malformed single-field index metadata: ${fieldPath}`);
  return modes(indexes.map(index => ({ ...index.fields[0], queryScope: index.queryScope })));
}

export function validateStatsIndexConfig(config, stage = statsIndexStage) {
  requireCondition(typeof stage === 'string' && Object.hasOwn(stageParents, stage), 'Unknown stats index rollout stage');
  requireCondition(!config.fieldOverrides.some(field => isTarget(field.collectionGroup) && field.fieldPath === '*'),
    'Collection wildcard changes non-stats query indexes; re-audit before rollout');
  const expected = [
    ...stageParents[stage].map(collectionGroup => ({ collectionGroup, fieldPath: 'stats', indexes: [] })),
    ...statsIndexAllowlist,
  ];
  const actual = config.fieldOverrides.filter(field => isTarget(field.collectionGroup) && isStats(field.fieldPath));
  requireCondition(actual.length === expected.length, 'Unexpected or duplicate stats field overrides');
  for (const field of expected) {
    const match = actual.filter(candidate => key(candidate) === key(field));
    requireCondition(match.length === 1 && same(modes(match[0].indexes), modes(field.indexes))
      && Array.isArray(match[0].indexes) && match[0].ttl !== true, `Incorrect stats index configuration: ${key(field)}`);
  }
  for (const index of config.indexes.filter(index => isTarget(index.collectionGroup))) {
    for (const field of index.fields.filter(field => isStats(field.fieldPath))) {
      requireCondition(statsIndexAllowlist.some(allowed => key(allowed) === `${index.collectionGroup}/${field.fieldPath}`),
        `Composite indexes an unapproved stats field: ${index.collectionGroup}/${field.fieldPath}`);
    }
  }
}

function compositeKey(index) {
  const collectionGroup = index.collectionGroup || index.name?.match(/\/collectionGroups\/([^/]+)\/indexes\//)?.[1];
  return JSON.stringify({ collectionGroup, queryScope: index.queryScope, fields: index.fields.map(field => ({
    fieldPath: field.fieldPath,
    ...(field.order ? { order: field.order } : {}),
    ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : {}),
    ...(field.vectorConfig ? { vectorConfig: field.vectorConfig } : {}),
  })) });
}

function checkBaseline(config, fields, composites, project, database, stage) {
  validateStatsIndexConfig(config, stage);
  requireCondition(Array.isArray(fields) && Array.isArray(composites), 'Expected fresh gcloud JSON arrays');
  const prefix = `projects/${project}/databases/${database}/collectionGroups/`;
  requireCondition(fields.every(field => field.name?.startsWith(prefix))
    && composites.every(index => index.name?.startsWith(prefix)), 'Snapshot project/database mismatch');
  requireCondition(new Set(fields.map(field => field.name)).size === fields.length
    && new Set(composites.map(index => index.name)).size === composites.length, 'Duplicate snapshot resources');
  const defaults = fields.find(field => field.name === `${prefix}__default__/fields/*`);
  requireCondition(defaults && same(apiModes(defaults.indexConfig?.indexes, '*'), modes(array))
    && defaults.indexConfig.indexes.every(index => index.state === 'READY'), 'Unexpected database defaults; re-audit inheritance');
  for (const field of fields) {
    const match = field.name.match(/\/collectionGroups\/(events|activities)\/fields\/(.+)$/);
    requireCondition(!match || match[2] !== '*', 'Collection wildcard overrides database defaults; re-audit inheritance');
    if (!match || !isStats(match[2])) continue;
    requireCondition(field.indexConfig?.reverting !== true, 'Stats configuration is reverting; wait for completion');
    requireCondition(match[2] === 'stats' || statsIndexAllowlist.some(allowed => key(allowed) === `${match[1]}/${match[2]}`),
      `Unexpected explicit stats override: ${match[1]}/${match[2]}`);
    if (match[2] === 'stats') {
      const indexes = field.indexConfig?.indexes || [];
      requireCondition(!indexes.length || (same(apiModes(indexes, 'stats'), modes(array))
        && indexes.every(index => index.state === 'READY')), 'Unexpected stats parent modes or unfinished build; re-audit');
    }
  }
  // Compare every live event/activity composite, not only those that mention stats.
  const target = config.indexes.filter(index => isTarget(index.collectionGroup)).map(compositeKey).sort();
  const live = composites.filter(index => /\/collectionGroups\/(events|activities)\/indexes\//.test(index.name));
  requireCondition(live.every(index => index.state === 'READY') && same(live.map(compositeKey).sort(), target),
    'Event/activity composite index drift or unfinished build; stop and reconcile');
  return prefix;
}

export function checkReadiness(config, fields, composites, project, database, stage = statsIndexStage) {
  const prefix = checkBaseline(config, fields, composites, project, database, stage);
  for (const field of statsIndexAllowlist) {
    const matches = fields.filter(candidate => candidate.name === `${prefix}${field.collectionGroup}/fields/${field.fieldPath}`);
    const current = matches[0]?.indexConfig;
    requireCondition(matches.length === 1 && current && current.usesAncestorConfig !== true && current.reverting !== true
      && same(apiModes(current.indexes, field.fieldPath), modes(field.indexes))
      && current.indexes.every(index => index.state === 'READY'), `Explicit child indexes not READY: ${key(field)}`);
  }
}

export function checkPreparation(config, fields, composites, project, database, stage = statsIndexStage) {
  const prefix = checkBaseline(config, fields, composites, project, database, stage);
  for (const collectionGroup of ['events', 'activities']) {
    const parent = fields.find(field => field.name === `${prefix}${collectionGroup}/fields/stats`);
    requireCondition(!parent || same(apiModes(parent.indexConfig?.indexes || [], 'stats'), modes(array)),
      'Preparation requires enabled parent defaults; use the approved repair/rollback procedure');
  }
  for (const field of statsIndexAllowlist) {
    const current = fields.find(candidate => candidate.name === `${prefix}${field.collectionGroup}/fields/${field.fieldPath}`);
    if (!current) continue;
    const indexes = current.indexConfig?.indexes || [];
    // --index replaces the entire list. Never silently remove an existing mode/scope.
    requireCondition(current.indexConfig?.usesAncestorConfig !== true
      && indexes.every(index => index.state === 'READY')
      && apiModes(indexes, field.fieldPath).every(mode => modes(field.indexes).includes(mode)),
    `Preparation would replace unaudited modes or unfinished indexes: ${key(field)}`);
  }
}

export function createRolloutPlan(config, phase, project, database, snapshots, stage = statsIndexStage) {
  requireCondition(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project || ''), 'An explicit project ID is required');
  requireCondition(database === '(default)' || /^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(database || ''), 'An explicit database ID is required');
  requireCondition(['prepare', 'enforce-events', 'enforce-activities', 'rollback'].includes(phase), 'Unknown rollout phase');
  validateStatsIndexConfig(config, stage);
  requireCondition(snapshots, 'Every phase requires fresh field and composite snapshots');
  if (phase.startsWith('enforce-')) {
    const group = phase.slice('enforce-'.length);
    requireCondition(stageParents[stage].includes(group), `Parent exemption is not enabled by committed rollout stage: ${stage}`);
    checkReadiness(config, snapshots.fields, snapshots.composites, project, database, stage);
    const parent = name => snapshots.fields.find(field => field.name ===
      `projects/${project}/databases/${database}/collectionGroups/${name}/fields/stats`);
    if (group === 'activities') {
      const events = parent('events')?.indexConfig;
      requireCondition(events && events.usesAncestorConfig !== true && !(events.indexes || []).length,
        'Activities enforcement requires the explicit events exemption first');
    } else if (stage === 'events-exempt') {
      const activities = parent('activities');
      requireCondition(!activities || same(apiModes(activities.indexConfig?.indexes || [], 'stats'), modes(array)),
        'Activities parent drift during events-only rollout; reconcile before enforcement');
    }
  } else if (phase === 'prepare') {
    requireCondition(stage === 'prepare', 'Preparation requires the committed prepare stage');
    checkPreparation(config, snapshots.fields, snapshots.composites, project, database, stage);
  } else {
    checkBaseline(config, snapshots.fields, snapshots.composites, project, database, stage);
  }
  const fields = phase === 'prepare' ? statsIndexAllowlist
    : (phase === 'rollback' ? ['events', 'activities'] : [phase.slice('enforce-'.length)])
      .map(collectionGroup => ({ collectionGroup, fieldPath: 'stats', indexes: [] }));
  return {
    phase, stage, project, database,
    notice: 'Review-only argv. Nothing is executed. Cloud changes require separate approval. Snapshots must be captured immediately before each phase. Operation completion and observation remain manual gates.',
    commands: fields.map(field => [
      'gcloud', 'firestore', 'indexes', 'fields', 'update', field.fieldPath,
      `--collection-group=${field.collectionGroup}`, `--project=${project}`, `--database=${database}`,
      ...(phase === 'rollback' ? ['--clear-exemption'] : field.indexes.length
        ? field.indexes.map(index => `--index=${index.order ? `order=${index.order}` : `array-config=${index.arrayConfig}`}`)
        : ['--disable-indexes']),
    ]),
  };
}

// Intentionally no child_process, network client, shell execution or deploy mode.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [phase, project, database, fieldFile, compositeFile, ...extra] = process.argv.slice(2);
    requireCondition(!extra.length && fieldFile && compositeFile,
      'Usage: node tools/firestore-stats-indexes.mjs PHASE PROJECT DATABASE FIELDS.json COMPOSITES.json');
    const config = JSON.parse(readFileSync(resolve(root, 'firestore.indexes.json'), 'utf8'));
    const snapshots = fieldFile && compositeFile ? {
      fields: JSON.parse(readFileSync(fieldFile, 'utf8')),
      composites: JSON.parse(readFileSync(compositeFile, 'utf8')),
    } : undefined;
    process.stdout.write(`${JSON.stringify(createRolloutPlan(config, phase, project, database, snapshots), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
