import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { globSync } from 'tinyglobby';
import { loadConfigFromFile } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve(root, 'vitest.config.ts'));
assert(loaded, 'Frontend Vitest configuration must load');
const config = loaded.config;
const projects = config.test.projects;
const registry = JSON.parse(readFileSync(resolve(root, 'tools/frontend-test-environments.json'), 'utf8'));
const ordinaryExcludes = ['functions/**', 'node_modules/**', 'src/firestore.rules.spec.ts', 'src/storage.rules.spec.ts'];

function discover(include, exclude, cwd) {
  // Match Vitest's glob options, including hidden files and directories.
  return globSync(include, { cwd, ignore: exclude, dot: true, expandDirectories: false });
}

function allocation(cwd) {
  const files = new Map();
  for (const project of projects) {
    for (const file of discover(project.test.include, project.test.exclude, cwd)) {
      const owners = files.get(file) ?? [];
      owners.push(project.test.name);
      files.set(file, owners);
    }
  }
  return files;
}

test('opted-in specs exist, are explicit application paths and cannot overlap', () => {
  assert.deepEqual(Object.keys(registry).sort(), ['dom', 'node']);
  const all = Object.values(registry).flat();
  assert.equal(all.length, new Set(all).size, 'Duplicate or overlapping opt-ins');
  for (const files of Object.values(registry)) {
    assert(files.length > 0);
    for (const file of files) {
      assert.match(file, /^src\/app\/(?:[a-z0-9-]+\/)+[a-z0-9.-]+\.spec\.ts$/);
      assert(statSync(resolve(root, file)).isFile(), `Stale opt-in: ${file}`);
    }
  }
});

test('every currently discovered ordinary spec belongs to exactly one project', () => {
  const expected = discover('**/*.spec.ts', ordinaryExcludes, root).sort();
  const actual = allocation(root);
  assert.deepEqual([...actual.keys()].sort(), expected, 'Discovery must match the original runner');
  for (const [file, owners] of actual) assert.equal(owners.length, 1, `Duplicated spec: ${file}`);
  for (const file of registry.node) assert.deepEqual(actual.get(file), ['helpers-node']);
  for (const file of registry.dom) assert.deepEqual(actual.get(file), ['helpers-dom']);
});

test('future specs fall back to Angular while Functions and Rules stay excluded', t => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'qs-frontend-discovery-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const future = ['src/app/helpers/future-helper.spec.ts', 'src/app/components/future.component.spec.ts',
    'scripts/future-script.spec.ts', 'shared/future-contract.spec.ts',
    '.hidden/future.spec.ts', 'src/.hidden/future.spec.ts', 'src/app/helpers/.future.spec.ts'];
  const excluded = ['functions/src/future.spec.ts', 'node_modules/dependency/future.spec.ts',
    'src/firestore.rules.spec.ts', 'src/storage.rules.spec.ts'];
  for (const file of [registry.node[0], registry.dom[0], ...future, ...excluded]) {
    mkdirSync(dirname(resolve(fixture, file)), { recursive: true });
    writeFileSync(resolve(fixture, file), '');
  }
  const actual = allocation(fixture);
  assert.deepEqual(actual.get(registry.node[0]), ['helpers-node']);
  assert.deepEqual(actual.get(registry.dom[0]), ['helpers-dom']);
  for (const file of future) assert.deepEqual(actual.get(file), ['angular']);
  for (const file of excluded) assert.equal(actual.has(file), false, `Excluded suite discovered: ${file}`);
});

test('only Angular specs load the compiler plugin and global browser setup', () => {
  assert.equal(config.plugins?.flat(Infinity).filter(Boolean).length ?? 0, 0);
  for (const name of ['helpers-node', 'helpers-dom']) {
    const project = projects.find(p => p.test.name === name);
    assert(project);
    assert.equal(project.plugins?.flat(Infinity).filter(Boolean).length ?? 0, 0);
    assert.deepEqual(project.test.setupFiles, []);
    assert.equal(project.test.environment, name === 'helpers-node' ? 'node' : 'jsdom');
  }
  const angular = projects.find(p => p.test.name === 'angular');
  assert(angular.plugins.flat(Infinity).some(plugin => plugin?.name?.includes('angular')));
  assert.deepEqual(angular.test.setupFiles, ['src/test-setup.ts']);
  assert.equal(angular.test.environment, 'jsdom');
});

test('projects retain aliases, isolated forks and the global two-worker bound', () => {
  assert.equal(config.test.maxWorkers, 2);
  assert.equal(config.test.minWorkers, 1);
  assert.equal(config.test.pool, 'forks');
  assert.deepEqual(config.test.include, ['**/*.spec.ts']);
  assert.deepEqual(config.test.exclude, ordinaryExcludes);
  assert.equal(config.test.dangerouslyIgnoreUnhandledErrors ?? false, false);
  for (const project of projects) {
    assert.equal(project.test.pool, 'forks');
    assert.equal(project.test.isolate, true);
    assert.equal(project.test.globals, true);
    assert.deepEqual(project.test.server.deps.inline, ['firebase', '@sports-alliance/sports-lib']);
    assert.equal(project.resolve.alias['@shared'], resolve(root, 'shared'));
    assert.equal(project.resolve.alias.app, resolve(root, 'src/app'));
    assert.equal(project.test.dangerouslyIgnoreUnhandledErrors ?? false, false);
    assert.equal(project.test.passWithNoTests ?? false, false);
  }
});
