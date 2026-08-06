import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import {
  BUNDLED_SKILL_NAMES,
  DEFAULT_REPO_ROOT,
  assertSafeChild,
  assertInstalledPluginResult,
  buildPlugin,
  classifyMarketplaceRegistration,
  configurePlugin,
  createCodexEnvironment,
  createPluginVersion,
  pathsAreEquivalent,
  resolveAppId,
  validateAppId,
  validateInstalledPluginBundle,
  validatePluginSource,
} from './plugin-tool.mjs';

const temporaryRoots = [];
const pluginToolPath = fileURLToPath(new URL('./plugin-tool.mjs', import.meta.url));

function fixtureAgentYaml(skillName, index, {
  displayName = `Quantified Self Test ${index + 1}`,
  shortDescription = 'Analyze fitness and health test trends',
  defaultPrompt = `Use $${skillName} to analyze my test data.`,
  dependencyValue = 'quantified-self',
  allowImplicitInvocation = true,
} = {}) {
  return [
    'interface:',
    `  display_name: "${displayName}"`,
    `  short_description: "${shortDescription}"`,
    `  default_prompt: "${defaultPrompt}"`,
    'dependencies:',
    '  tools:',
    '    - type: "mcp"',
    `      value: "${dependencyValue}"`,
    '      description: "Read-only Quantified Self data"',
    '      transport: "streamable_http"',
    '      url: "https://quantified-self.io/mcp"',
    'policy:',
    `  allow_implicit_invocation: ${allowImplicitInvocation}`,
    '',
  ].join('\n');
}

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
        defaultPrompt: [
          'Test activity analysis.',
          'Test measurement analysis.',
          'Test cross-domain analysis.',
        ],
      },
    })}\n`,
  );
  await writeFile(
    join(root, 'src', 'assets', 'favicons', 'quantified-self-chatgpt-icon-256x256.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );
  await Promise.all(BUNDLED_SKILL_NAMES.map(async (skillName, index) => {
    const skillRoot = join(pluginRoot, 'skills', skillName);
    await mkdir(join(skillRoot, 'agents'), { recursive: true });
    await writeFile(
      join(skillRoot, 'SKILL.md'),
      [
        '---',
        `name: ${skillName}`,
        `description: Analyze ${skillName} test data.`,
        '---',
        '',
        `# Test Skill ${index + 1}`,
        '',
      ].join('\n'),
    );
    await writeFile(
      join(skillRoot, 'agents', 'openai.yaml'),
      fixtureAgentYaml(skillName, index),
    );
  }));
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

test('rejects a plugin root symlink that escapes the repository', async (context) => {
  if (process.platform === 'win32') {
    context.skip('Directory symlink creation requires elevated privileges on some Windows hosts.');
    return;
  }
  const root = await makeRepositoryFixture();
  const pluginRoot = join(root, 'plugins', 'quantified-self');
  const externalRoot = await mkdtemp(join(tmpdir(), 'quantified-self-plugin-external-'));
  temporaryRoots.push(externalRoot);
  await rm(pluginRoot, { recursive: true });
  await symlink(externalRoot, pluginRoot, 'dir');

  await assert.rejects(
    buildPlugin({
      repoRoot: root,
      appId: 'plugin_asdk_app_local',
      cachebuster: 'ci-test',
      environment: {},
    }),
    /Plugin root must be a child/,
  );
  await assert.rejects(readFile(join(externalRoot, '.app.json')), {
    code: 'ENOENT',
  });
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
  assert.equal(
    await resolveAppId({
      environment: {},
      configPath,
    }),
    'configured-id',
  );
  await writeFile(configPath, '{"appId":"configured-id","unexpected":true}\n');
  await assert.rejects(
    resolveAppId({
      environment: {},
      configPath,
    }),
    /must contain only an appId field/,
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

test('publishes the cache-busted manifest only after supporting files succeed', async () => {
  const root = await makeRepositoryFixture();
  const pluginRoot = join(root, 'plugins', 'quantified-self');
  const manifestPath = join(pluginRoot, '.codex-plugin', 'plugin.json');
  await writeFile(manifestPath, '{"stale":true}\n');
  await mkdir(join(pluginRoot, 'assets', 'quantified-self.png'), {
    recursive: true,
  });

  await assert.rejects(
    buildPlugin({
      repoRoot: root,
      appId: 'plugin_asdk_app_local',
      cachebuster: 'ci-test',
      environment: {},
    }),
  );
  assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), {
    stale: true,
  });
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

test('requires exactly three distinct bounded starter prompts before build output', async () => {
  const root = await makeRepositoryFixture();
  const templatePath = join(root, 'plugins', 'quantified-self', 'plugin.template.json');
  const template = JSON.parse(await readFile(templatePath, 'utf8'));

  for (const defaultPrompt of [
    ['First prompt.', 'Second prompt.'],
    ['Repeated prompt.', 'Repeated prompt.', 'Third prompt.'],
    ['First prompt.', 'Second prompt.', 'x'.repeat(129)],
  ]) {
    await writeFile(
      templatePath,
      `${JSON.stringify({
        ...template,
        interface: {
          ...template.interface,
          defaultPrompt,
        },
      })}\n`,
    );
    await assert.rejects(
      buildPlugin({
        repoRoot: root,
        appId: 'plugin_asdk_app_local',
        cachebuster: 'ci-invalid-prompts',
        environment: {},
      }),
      /exactly three distinct starter prompts/,
    );
    await assert.rejects(
      readFile(join(root, 'plugins', 'quantified-self', '.app.json')),
      { code: 'ENOENT' },
    );
  }
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

test('rejects missing bundled skill files before generating account-bound files', async () => {
  const root = await makeRepositoryFixture();
  await rm(
    join(
      root,
      'plugins',
      'quantified-self',
      'skills',
      'analyze-quantified-self',
      'agents',
      'openai.yaml',
    ),
  );
  await assert.rejects(
    buildPlugin({
      repoRoot: root,
      appId: 'plugin_asdk_app_local',
      cachebuster: 'ci-test',
      environment: {},
    }),
    /agent configuration does not exist/,
  );
  await assert.rejects(
    readFile(join(root, 'plugins', 'quantified-self', '.codex-plugin', 'plugin.json')),
    { code: 'ENOENT' },
  );
  await assert.rejects(readFile(join(root, 'plugins', 'quantified-self', '.app.json')), {
    code: 'ENOENT',
  });
});

test('requires exactly the registered six bundled skill directories', async () => {
  const missingRoot = await makeRepositoryFixture();
  await rm(
    join(
      missingRoot,
      'plugins',
      'quantified-self',
      'skills',
      'explore-quantified-self-routes',
    ),
    { recursive: true },
  );
  await assert.rejects(
    buildPlugin({
      repoRoot: missingRoot,
      appId: 'plugin_asdk_app_local',
      cachebuster: 'ci-test',
      environment: {},
    }),
    /skill set is incomplete or unexpected/,
  );
  await assert.rejects(
    readFile(join(missingRoot, 'plugins', 'quantified-self', '.app.json')),
    { code: 'ENOENT' },
  );

  const extraRoot = await makeRepositoryFixture();
  await mkdir(
    join(extraRoot, 'plugins', 'quantified-self', 'skills', 'unexpected-skill'),
  );
  await assert.rejects(
    buildPlugin({
      repoRoot: extraRoot,
      appId: 'plugin_asdk_app_local',
      cachebuster: 'ci-test',
      environment: {},
    }),
    /skill set is incomplete or unexpected/,
  );
  await assert.rejects(
    readFile(join(extraRoot, 'plugins', 'quantified-self', '.app.json')),
    { code: 'ENOENT' },
  );
});

test('strictly validates bundled skill and agent YAML before installation', async () => {
  const root = await makeRepositoryFixture();
  const skillRoot = join(
    root,
    'plugins',
    'quantified-self',
    'skills',
    'analyze-quantified-self',
  );
  await assert.doesNotReject(validatePluginSource({ repoRoot: root }));

  await writeFile(
    join(skillRoot, 'agents', 'openai.yaml'),
    'interface: [\n',
  );
  await assert.rejects(
    validatePluginSource({ repoRoot: root }),
    /agent configuration is not valid YAML/,
  );
  const validationResult = spawnSync(
    process.execPath,
    [
      pluginToolPath,
      'validate',
      '--repo-root',
      root,
      '--cachebuster',
      'ci-invalid-skill',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        QS_CHATGPT_APP_ID: 'plugin_asdk_app_invalid_skill',
      },
    },
  );
  assert.equal(validationResult.status, 1);
  assert.match(validationResult.stderr, /agent configuration is not valid YAML/);
  await assert.rejects(
    readFile(join(root, 'plugins', 'quantified-self', '.codex-plugin', 'plugin.json')),
    { code: 'ENOENT' },
  );

  await writeFile(
    join(skillRoot, 'SKILL.md'),
    [
      '---',
      'name: [',
      'description: Malformed frontmatter.',
      '---',
      '',
    ].join('\n'),
  );
  await assert.rejects(
    validatePluginSource({ repoRoot: root }),
    /frontmatter is not valid YAML/,
  );

  await writeFile(
    join(skillRoot, 'SKILL.md'),
    [
      '---',
      'name: wrong-skill',
      'description: Wrong identity.',
      '---',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(skillRoot, 'agents', 'openai.yaml'),
    [
      'interface:',
      '  display_name: "Analyze Quantified Self"',
      '  short_description: "Analyze fitness and health trends"',
      '  default_prompt: "Use $analyze-quantified-self to analyze my data."',
      'dependencies:',
      '  tools:',
      '    - type: "mcp"',
      '      value: "quantified-self"',
      '      description: "Read-only Quantified Self data"',
      '      transport: "streamable_http"',
      '      url: "https://quantified-self.io/mcp"',
      'policy:',
      '  allow_implicit_invocation: true',
      '',
    ].join('\n'),
  );
  await assert.rejects(
    validatePluginSource({ repoRoot: root }),
    /identity is invalid/,
  );

  await writeFile(
    join(skillRoot, 'SKILL.md'),
    [
      '---',
      'name: analyze-quantified-self',
      'description: Analyze <unsafe> test data.',
      '---',
      '',
    ].join('\n'),
  );
  await assert.rejects(
    validatePluginSource({ repoRoot: root }),
    /identity is invalid/,
  );
});

test('validates each skill prompt, dependency, policy, and UI metadata', async () => {
  const root = await makeRepositoryFixture();
  const skillName = 'analyze-quantified-self-sleep';
  const skillIndex = BUNDLED_SKILL_NAMES.indexOf(skillName);
  const agentPath = join(
    root,
    'plugins',
    'quantified-self',
    'skills',
    skillName,
    'agents',
    'openai.yaml',
  );

  await writeFile(agentPath, fixtureAgentYaml(skillName, skillIndex, {
    defaultPrompt: 'Use $analyze-quantified-self-training for this request.',
  }));
  await assert.rejects(
    buildPlugin({
      repoRoot: root,
      appId: 'plugin_asdk_app_local',
      cachebuster: 'ci-invalid-prompt',
      environment: {},
    }),
    /default prompt must name the skill/,
  );
  await assert.rejects(
    readFile(join(root, 'plugins', 'quantified-self', '.app.json')),
    { code: 'ENOENT' },
  );

  await writeFile(agentPath, fixtureAgentYaml(skillName, skillIndex, {
    dependencyValue: 'other-app',
  }));
  await assert.rejects(
    validatePluginSource({ repoRoot: root }),
    /MCP dependency is invalid/,
  );

  await writeFile(agentPath, fixtureAgentYaml(skillName, skillIndex, {
    allowImplicitInvocation: false,
  }));
  await assert.rejects(
    validatePluginSource({ repoRoot: root }),
    /must allow implicit invocation/,
  );

  await writeFile(agentPath, fixtureAgentYaml(skillName, skillIndex, {
    shortDescription: 'Too short',
  }));
  await assert.rejects(
    validatePluginSource({ repoRoot: root }),
    /short description must contain 25-64 characters/,
  );

  await writeFile(agentPath, fixtureAgentYaml(skillName, skillIndex, {
    displayName: 'Quantified Self Test 1',
  }));
  await assert.rejects(
    validatePluginSource({ repoRoot: root }),
    /display names must be unique/,
  );

  const umbrellaName = 'analyze-quantified-self';
  const umbrellaAgentPath = join(
    root,
    'plugins',
    'quantified-self',
    'skills',
    umbrellaName,
    'agents',
    'openai.yaml',
  );
  await writeFile(
    umbrellaAgentPath,
    fixtureAgentYaml(umbrellaName, 0, {
      defaultPrompt:
        'Use $analyze-quantified-self-training for this request.',
    }),
  );
  await assert.rejects(
    validatePluginSource({ repoRoot: root }),
    /default prompt must name the skill/,
  );
});

test('rejects symbolic links anywhere in the bundled skill tree', async (context) => {
  if (process.platform === 'win32') {
    context.skip('File symlink creation requires elevated privileges on some Windows hosts.');
    return;
  }
  const root = await makeRepositoryFixture();
  const skillRoot = join(
    root,
    'plugins',
    'quantified-self',
    'skills',
    'explore-quantified-self-routes',
  );
  await symlink('SKILL.md', join(skillRoot, 'linked-skill.md'));
  await assert.rejects(
    validatePluginSource({ repoRoot: root }),
    /must not contain symbolic links/,
  );
});

test('compares every installed bundled skill file with its source', async () => {
  const root = await makeRepositoryFixture();
  const built = await buildPlugin({
    repoRoot: root,
    appId: 'plugin_asdk_app_local',
    cachebuster: 'ci-installed-tree',
    environment: {},
  });
  const installedParent = await mkdtemp(join(tmpdir(), 'quantified-self-installed-test-'));
  temporaryRoots.push(installedParent);
  const installedPath = join(installedParent, 'quantified-self');
  await cp(built.pluginRoot, installedPath, { recursive: true });

  await assert.doesNotReject(validateInstalledPluginBundle({
    repoRoot: root,
    installedPath,
    expectedVersion: built.version,
    appId: 'plugin_asdk_app_local',
  }));

  const activitySkillPath = join(
    installedPath,
    'skills',
    'analyze-quantified-self-activity',
    'SKILL.md',
  );
  const originalActivitySkill = await readFile(activitySkillPath);
  await writeFile(activitySkillPath, 'tampered');
  await assert.rejects(
    validateInstalledPluginBundle({
      repoRoot: root,
      installedPath,
      expectedVersion: built.version,
      appId: 'plugin_asdk_app_local',
    }),
    /incomplete or inconsistent/,
  );

  await writeFile(activitySkillPath, originalActivitySkill);
  const installedRouteConfigPath = join(
    installedPath,
    'skills',
    'explore-quantified-self-routes',
    'agents',
    'openai.yaml',
  );
  await rm(installedRouteConfigPath);
  await assert.rejects(
    validateInstalledPluginBundle({
      repoRoot: root,
      installedPath,
      expectedVersion: built.version,
      appId: 'plugin_asdk_app_local',
    }),
    /incomplete or inconsistent/,
  );

  await writeFile(
    installedRouteConfigPath,
    await readFile(join(
      root,
      'plugins',
      'quantified-self',
      'skills',
      'explore-quantified-self-routes',
      'agents',
      'openai.yaml',
    )),
  );
  await writeFile(
    join(installedPath, 'skills', 'unexpected-file.md'),
    'unexpected',
  );
  await assert.rejects(
    validateInstalledPluginBundle({
      repoRoot: root,
      installedPath,
      expectedVersion: built.version,
      appId: 'plugin_asdk_app_local',
    }),
    /incomplete or inconsistent/,
  );

  await rm(join(installedPath, 'skills', 'unexpected-file.md'));
  await mkdir(
    join(
      installedPath,
      'skills',
      'analyze-quantified-self',
      'unexpected-empty-directory',
    ),
  );
  await assert.rejects(
    validateInstalledPluginBundle({
      repoRoot: root,
      installedPath,
      expectedVersion: built.version,
      appId: 'plugin_asdk_app_local',
    }),
    /incomplete or inconsistent/,
  );
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

test('canonicalizes symlinked paths and executes the CLI through a symlink', async (context) => {
  if (process.platform === 'win32') {
    context.skip('File symlink creation requires elevated privileges on some Windows hosts.');
    return;
  }
  const root = await makeRepositoryFixture();
  const linkedToolPath = join(root, 'linked-plugin-tool.mjs');
  await symlink(pluginToolPath, linkedToolPath);
  assert.equal(pathsAreEquivalent(linkedToolPath, pluginToolPath), true);

  const result = spawnSync(
    process.execPath,
    [
      linkedToolPath,
      'build',
      '--repo-root',
      root,
      '--cachebuster',
      'ci-symlink-test',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        QS_CHATGPT_APP_ID: 'plugin_asdk_app_symlink_test',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Built quantified-self 0\.1\.0\+codex\.ci-symlink-test\./);
});

test('does not pass plugin build configuration into Codex child processes', () => {
  assert.deepEqual(
    createCodexEnvironment({
      environment: {
        PATH: '/usr/bin',
        CODEX_HOME: '/existing',
        QS_CHATGPT_APP_ID: 'plugin_asdk_app_private',
        QS_PLUGIN_CACHEBUSTER: 'private-build',
        qs_chatgpt_app_id: 'plugin_asdk_app_private_lowercase',
        qs_plugin_cachebuster: 'private-build-lowercase',
      },
      codexHome: '/isolated',
    }),
    {
      PATH: '/usr/bin',
      CODEX_HOME: '/isolated',
    },
  );
});

test('launches the pinned Codex entrypoint without a command shell', async () => {
  const source = await readFile(pluginToolPath, 'utf8');
  assert.match(
    source,
    /spawnSync\(process\.execPath, \[paths\.codexPath, \.\.\.args\]/,
  );
  assert.doesNotMatch(source, /\bshell\s*:/);
  assert.doesNotMatch(source, /\.cmd['"]/);
});

test('rejects stale or malformed local installation results', () => {
  const expected = {
    pluginId: 'quantified-self@quantified-self-local',
    version: '0.1.0+codex.ci-test',
    installedPath: '/tmp/codex/plugins/quantified-self',
  };
  assert.equal(
    assertInstalledPluginResult(expected, expected.version),
    expected,
  );
  assert.throws(
    () =>
      assertInstalledPluginResult(
        { ...expected, version: '0.1.0+codex.previous' },
        expected.version,
      ),
    /unexpected plugin result/,
  );
  assert.throws(
    () =>
      assertInstalledPluginResult(
        { ...expected, installedPath: '' },
        expected.version,
      ),
    /unexpected plugin result/,
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

  const ignoredOptionResult = spawnSync(
    process.execPath,
    [
      pluginToolPath,
      'configure',
      '--repo-root',
      root,
      '--cachebuster',
      'ignored-value',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        QS_CHATGPT_APP_ID: appId,
      },
    },
  );
  assert.equal(ignoredOptionResult.status, 1);
  assert.match(ignoredOptionResult.stderr, /Unknown argument: --cachebuster/);
});

test('bundled skills cover focused workflows without copying the live tool catalog', async () => {
  const expectedMarkers = new Map([
    ['analyze-quantified-self', /Cross-Domain Workflow/],
    ['analyze-quantified-self-activity', /server, not the model/],
    ['analyze-quantified-self-measurements', /first-class recorded measurements/],
    ['analyze-quantified-self-sleep', /normalized sleep summaries/],
    ['analyze-quantified-self-training', /live metric catalog/],
    ['explore-quantified-self-routes', /saved-route summaries/],
  ]);
  assert.deepEqual(
    [...expectedMarkers.keys()].sort(),
    [...BUNDLED_SKILL_NAMES].sort(),
  );

  for (const [skillName, expectedMarker] of expectedMarkers) {
    const skill = await readFile(
      join(
        DEFAULT_REPO_ROOT,
        'plugins',
        'quantified-self',
        'skills',
        skillName,
        'SKILL.md',
      ),
      'utf8',
    );
    assert.match(skill, expectedMarker, skillName);
    assert.doesNotMatch(skill, /\[TODO|TODO:/, skillName);
    assert.doesNotMatch(
      skill,
      /\b(?:list|query|get|find)_[a-z0-9_]+\b/,
      skillName,
    );
  }
});

test('every CLI-dependent root command bootstraps the pinned plugin tooling', async () => {
  const rootPackage = JSON.parse(
    await readFile(join(DEFAULT_REPO_ROOT, 'package.json'), 'utf8'),
  );
  for (const command of [
    'plugin:build',
    'plugin:validate',
    'plugin:setup',
    'plugin:sync',
  ]) {
    assert.match(rootPackage.scripts[command], /^npm run plugin:tools && /);
  }
});
