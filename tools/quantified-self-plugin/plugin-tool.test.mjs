import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import {
  DEFAULT_REPO_ROOT,
  assertSafeChild,
  buildPlugin,
  classifyMarketplaceRegistration,
  configurePlugin,
  createPluginVersion,
  resolveAppId,
  validateAppId,
} from './plugin-tool.mjs';

const temporaryRoots = [];
const pluginToolPath = fileURLToPath(new URL('./plugin-tool.mjs', import.meta.url));

async function makeRepositoryFixture() {
  const root = await mkdtemp(join(tmpdir(), 'quantified-self-plugin-test-'));
  temporaryRoots.push(root);
  const pluginRoot = join(root, 'plugins', 'quantified-self');
  await mkdir(join(pluginRoot, '.codex-plugin'), { recursive: true });
  await mkdir(join(root, 'src', 'assets', 'favicons'), { recursive: true });
  await writeFile(
    join(pluginRoot, 'plugin.template.json'),
    `${JSON.stringify({
      name: 'quantified-self',
      version: '0.1.0',
      description: 'Test plugin',
      author: { name: 'Test' },
      skills: './skills/',
      apps: './.app.json',
      interface: {
        displayName: 'Quantified Self',
        shortDescription: 'Test plugin',
        longDescription: 'Test plugin',
        developerName: 'Test',
        category: 'Lifestyle',
        capabilities: ['Read'],
        defaultPrompt: ['Test'],
      },
    })}\n`,
  );
  await writeFile(
    join(root, 'src', 'assets', 'favicons', 'quantified-self-chatgpt-icon-256x256.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

test('validates app IDs without assuming a product-specific prefix', () => {
  assert.equal(validateAppId('plugin_asdk_app_example-123'), 'plugin_asdk_app_example-123');
  assert.equal(validateAppId('asdk_app_example:123'), 'asdk_app_example:123');
  for (const invalid of ['', 'ab', ' app-id', 'app id', 'app-id\n']) {
    assert.throws(() => validateAppId(invalid), /visible ASCII/);
  }
});

test('replaces existing build metadata with one Codex cachebuster', () => {
  assert.equal(
    createPluginVersion('0.1.0+codex.previous', 'local-20260727'),
    '0.1.0+codex.local-20260727',
  );
  assert.throws(
    () => createPluginVersion('not-semver', 'local-20260727'),
    /semantic versioning/,
  );
  assert.throws(
    () => createPluginVersion('0.1.0', 'invalid_cachebuster'),
    /cachebuster/,
  );
});

test('rejects output paths outside their declared root', () => {
  assert.doesNotThrow(() =>
    assertSafeChild('/tmp/repository', '/tmp/repository/plugin/file.json', 'Output'),
  );
  assert.throws(
    () => assertSafeChild('/tmp/repository', '/tmp/other/file.json', 'Output'),
    /must be a child/,
  );
  assert.throws(
    () => assertSafeChild('/tmp/repository', '/tmp/repository', 'Output'),
    /must be a child/,
  );
});

test('resolves an explicit app ID before environment and local configuration', async () => {
  const root = await makeRepositoryFixture();
  const configPath = join(root, '.local', 'quantified-self-plugin.json');
  await mkdir(join(root, '.local'), { recursive: true });
  await writeFile(configPath, '{"appId":"configured-id"}\n');
  assert.equal(
    await resolveAppId({
      explicitAppId: 'explicit-id',
      environment: { QS_CHATGPT_APP_ID: 'environment-id' },
      configPath,
    }),
    'explicit-id',
  );
  assert.equal(
    await resolveAppId({
      environment: { QS_CHATGPT_APP_ID: 'environment-id' },
      configPath,
    }),
    'environment-id',
  );
});

test('rejects a missing app ID before build output is written', async () => {
  const root = await makeRepositoryFixture();
  await assert.rejects(
    buildPlugin({
      repoRoot: root,
      cachebuster: 'ci-test',
      environment: {},
    }),
    /No ChatGPT app ID is configured/,
  );
  await assert.rejects(readFile(join(root, 'plugins', 'quantified-self', '.app.json')), {
    code: 'ENOENT',
  });
});

test('writes local configuration without widening its permissions', async () => {
  const root = await makeRepositoryFixture();
  const result = await configurePlugin({
    repoRoot: root,
    appId: 'plugin_asdk_app_local',
    environment: {},
  });
  assert.deepEqual(
    JSON.parse(await readFile(result.configPath, 'utf8')),
    { appId: 'plugin_asdk_app_local' },
  );
  if (process.platform !== 'win32') {
    assert.equal((await stat(result.configPath)).mode & 0o777, 0o600);
  }
});

test('builds an exact app mapping, cache-busted manifest, and copied icon', async () => {
  const root = await makeRepositoryFixture();
  const pluginRoot = join(root, 'plugins', 'quantified-self');
  await writeFile(join(pluginRoot, '.codex-plugin', 'plugin.json'), '{"stale":true}\n');
  await writeFile(join(pluginRoot, '.app.json'), '{"stale":true}\n');
  await mkdir(join(pluginRoot, 'assets'), { recursive: true });
  await writeFile(join(pluginRoot, 'assets', 'quantified-self.png'), 'stale');
  const built = await buildPlugin({
    repoRoot: root,
    appId: 'plugin_asdk_app_local',
    cachebuster: 'ci-abcdef123456',
    environment: {},
  });
  const manifest = JSON.parse(await readFile(built.manifestPath, 'utf8'));
  const appManifest = JSON.parse(await readFile(built.appPath, 'utf8'));
  assert.equal(manifest.version, '0.1.0+codex.ci-abcdef123456');
  assert.deepEqual(appManifest, {
    apps: {
      'quantified-self': {
        id: 'plugin_asdk_app_local',
      },
    },
  });
  assert.deepEqual(
    await readFile(built.iconPath),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );
  if (process.platform !== 'win32') {
    assert.equal((await stat(built.appPath)).mode & 0o777, 0o600);
  }
});

test('rejects malformed and wrong-identity templates before generating account-bound files', async () => {
  const root = await makeRepositoryFixture();
  const templatePath = join(root, 'plugins', 'quantified-self', 'plugin.template.json');
  await writeFile(templatePath, '{');
  await assert.rejects(
    buildPlugin({
      repoRoot: root,
      appId: 'plugin_asdk_app_local',
      cachebuster: 'ci-test',
      environment: {},
    }),
    /not valid JSON/,
  );
  await writeFile(templatePath, '{"name":"other","version":"0.1.0"}\n');
  await assert.rejects(
    buildPlugin({
      repoRoot: root,
      appId: 'plugin_asdk_app_local',
      cachebuster: 'ci-test',
      environment: {},
    }),
    /identity is invalid/,
  );
  await assert.rejects(readFile(join(root, 'plugins', 'quantified-self', '.app.json')), {
    code: 'ENOENT',
  });
  await writeFile(
    templatePath,
    '{"name":"quantified-self","version":"not-semver"}\n',
  );
  await assert.rejects(
    buildPlugin({
      repoRoot: root,
      appId: 'plugin_asdk_app_local',
      cachebuster: 'ci-test',
      environment: {},
    }),
    /semantic versioning/,
  );
});

test('rejects a missing icon before generating account-bound files', async () => {
  const root = await makeRepositoryFixture();
  await rm(
    join(
      root,
      'src',
      'assets',
      'favicons',
      'quantified-self-chatgpt-icon-256x256.png',
    ),
  );
  await assert.rejects(
    buildPlugin({
      repoRoot: root,
      appId: 'plugin_asdk_app_local',
      cachebuster: 'ci-test',
      environment: {},
    }),
    { code: 'ENOENT' },
  );
  await assert.rejects(readFile(join(root, 'plugins', 'quantified-self', '.app.json')), {
    code: 'ENOENT',
  });
});

test('classifies matching marketplaces and fails closed on name or root collisions', () => {
  assert.equal(classifyMarketplaceRegistration([], '/workspace/quantified-self'), 'add');
  assert.equal(
    classifyMarketplaceRegistration(
      [{ name: 'quantified-self-local', root: '/workspace/quantified-self' }],
      '/workspace/quantified-self',
    ),
    'existing',
  );
  assert.throws(
    () =>
      classifyMarketplaceRegistration(
        [{ name: 'quantified-self-local', root: '/workspace/other' }],
        '/workspace/quantified-self',
      ),
    /different repository/,
  );
  assert.throws(
    () =>
      classifyMarketplaceRegistration(
        [{ name: 'other-local', root: '/workspace/quantified-self' }],
        '/workspace/quantified-self',
      ),
    /already registered/,
  );
  assert.throws(
    () => classifyMarketplaceRegistration([{ name: 'broken' }], '/workspace/quantified-self'),
    /invalid marketplace entry/,
  );
  assert.throws(
    () =>
      classifyMarketplaceRegistration(
        [
          { name: 'quantified-self-local', root: '/workspace/quantified-self' },
          { name: 'quantified-self-local', root: '/workspace/quantified-self' },
        ],
        '/workspace/quantified-self',
      ),
    /registered more than once/,
  );
});

test('CLI build output does not disclose the configured app ID', async () => {
  const root = await makeRepositoryFixture();
  const appId = 'plugin_asdk_app_must_not_be_logged';
  const result = spawnSync(
    process.execPath,
    [
      pluginToolPath,
      'build',
      '--repo-root',
      root,
      '--cachebuster',
      'ci-log-test',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        QS_CHATGPT_APP_ID: appId,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(appId));
});

test('CLI rejects app IDs passed as npm-visible command-line arguments', async () => {
  const root = await makeRepositoryFixture();
  const appId = 'plugin_asdk_app_must_not_be_an_argument';
  const result = spawnSync(
    process.execPath,
    [
      pluginToolPath,
      'configure',
      '--repo-root',
      root,
      '--app-id',
      appId,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument: --app-id/);
  assert.doesNotMatch(result.stderr, new RegExp(appId));
});

test('bundled skill stays discoverable without duplicating a static metric catalog', async () => {
  const skill = await readFile(
    join(
      DEFAULT_REPO_ROOT,
      'plugins',
      'quantified-self',
      'skills',
      'analyze-quantified-self',
      'SKILL.md',
    ),
    'utf8',
  );
  assert.match(skill, /body measurements such as weight/);
  assert.match(skill, /workout charts/);
  assert.match(skill, /sleep/);
  assert.match(skill, /routes/);
  assert.match(skill, /Inspect the relevant catalog/);
  assert.doesNotMatch(skill, /\[TODO|TODO:/);
});
