import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { constants as fsConstants, existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';

export const PLUGIN_NAME = 'quantified-self';
export const MARKETPLACE_NAME = 'quantified-self-local';
export const PLUGIN_LICENSE = 'AGPL-3.0-only';
export const BUNDLED_SKILL_NAMES = Object.freeze([
  'analyze-quantified-self',
  'analyze-quantified-self-activity',
  'analyze-quantified-self-measurements',
  'analyze-quantified-self-sleep',
  'analyze-quantified-self-training',
  'explore-quantified-self-routes',
]);

const TOOL_ROOT = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(TOOL_ROOT, '..', '..');

const APP_ID_PATTERN = /^[\x21-\x7E]{3,512}$/;
const CACHEBUSTER_PATTERN = /^[0-9A-Za-z-]{1,64}$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function pathsFor(repoRoot) {
  const normalizedRoot = resolve(repoRoot);
  const pluginRoot = join(normalizedRoot, 'plugins', PLUGIN_NAME);
  return {
    repoRoot: normalizedRoot,
    pluginRoot,
    skillsRoot: join(pluginRoot, 'skills'),
    templatePath: join(pluginRoot, 'plugin.template.json'),
    manifestPath: join(pluginRoot, '.codex-plugin', 'plugin.json'),
    appPath: join(pluginRoot, '.app.json'),
    sourceIconPath: join(
      normalizedRoot,
      'src',
      'assets',
      'favicons',
      'quantified-self-chatgpt-icon-256x256.png',
    ),
    iconPath: join(pluginRoot, 'assets', 'quantified-self.png'),
    configPath: join(normalizedRoot, '.local', 'quantified-self-plugin.json'),
    codexPath: join(
      normalizedRoot,
      'tools',
      'quantified-self-plugin',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    ),
  };
}

function skillPathsFor(paths, skillName) {
  const skillRoot = join(paths.skillsRoot, skillName);
  return {
    skillName,
    skillRoot,
    skillPath: join(skillRoot, 'SKILL.md'),
    agentPath: join(skillRoot, 'agents', 'openai.yaml'),
  };
}

export function assertSafeChild(root, target, label) {
  const resolvedRoot = normalizePathForComparison(root);
  const resolvedTarget = normalizePathForComparison(target);
  const childPath = relative(resolvedRoot, resolvedTarget);
  if (
    childPath === ''
    || childPath === '..'
    || childPath.startsWith(`..${sep}`)
    || isAbsolute(childPath)
  ) {
    throw new Error(`${label} must be a child of its declared root.`);
  }
}

function normalizeAppId(value) {
  if (typeof value !== 'string' || value !== value.trim() || !APP_ID_PATTERN.test(value)) {
    throw new Error(
      'The ChatGPT app ID must be 3-512 visible ASCII characters without whitespace.',
    );
  }
  return value;
}

export function validateAppId(value) {
  return normalizeAppId(value);
}

export function createPluginVersion(baseVersion, cachebuster) {
  const base = `${baseVersion}`.split('+', 1)[0];
  if (!SEMVER_PATTERN.test(base)) {
    throw new Error('The plugin template version must use semantic versioning.');
  }
  if (typeof cachebuster !== 'string' || !CACHEBUSTER_PATTERN.test(cachebuster)) {
    throw new Error('The plugin cachebuster must contain 1-64 letters, digits, or hyphens.');
  }
  return `${base}+codex.${cachebuster}`;
}

function defaultCachebuster(now = new Date()) {
  const timestamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:TZ]/g, '');
  return `local-${timestamp}`;
}

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} does not exist.`);
    }
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function writeFileAtomic(path, contents, mode = 0o644) {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const temporaryPath = join(parent, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode });
    await rename(temporaryPath, path);
    await chmod(path, mode);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function writeJsonAtomic(path, value, mode = 0o644) {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, mode);
}

async function copyFileAtomic(sourcePath, destinationPath) {
  const parent = dirname(destinationPath);
  await mkdir(parent, { recursive: true });
  const temporaryPath = join(parent, `.${randomUUID()}.tmp`);
  try {
    await copyFile(sourcePath, temporaryPath, fsConstants.COPYFILE_FICLONE);
    await chmod(temporaryPath, 0o644);
    await rename(temporaryPath, destinationPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function appIdFromLocalConfig(configPath) {
  let config;
  try {
    config = await readJson(configPath, 'Local plugin configuration');
  } catch (error) {
    if (error.message === 'Local plugin configuration does not exist.') {
      return undefined;
    }
    throw error;
  }
  if (
    config === null
    || Array.isArray(config)
    || typeof config !== 'object'
    || Object.keys(config).some((key) => key !== 'appId')
  ) {
    throw new Error('Local plugin configuration must contain only an appId field.');
  }
  return normalizeAppId(config.appId);
}

export async function resolveAppId({
  explicitAppId,
  environment = process.env,
  configPath,
}) {
  if (explicitAppId !== undefined) {
    return normalizeAppId(explicitAppId);
  }
  if (environment.QS_CHATGPT_APP_ID !== undefined) {
    return normalizeAppId(environment.QS_CHATGPT_APP_ID);
  }
  const configured = await appIdFromLocalConfig(configPath);
  if (configured !== undefined) {
    return configured;
  }
  throw new Error(
    'No ChatGPT app ID is configured. Set QS_CHATGPT_APP_ID, then run npm run plugin:configure.',
  );
}

export async function configurePlugin({
  repoRoot = DEFAULT_REPO_ROOT,
  appId,
  environment = process.env,
} = {}) {
  const paths = pathsFor(repoRoot);
  assertSafeChild(paths.repoRoot, paths.configPath, 'Local plugin configuration');
  const resolvedAppId = await resolveAppId({
    explicitAppId: appId,
    environment,
    configPath: paths.configPath,
  });
  await writeJsonAtomic(paths.configPath, { appId: resolvedAppId }, 0o600);
  return { configPath: paths.configPath };
}

export async function buildPlugin({
  repoRoot = DEFAULT_REPO_ROOT,
  appId,
  cachebuster,
  environment = process.env,
  now = new Date(),
} = {}) {
  const paths = pathsFor(repoRoot);
  assertSafeChild(paths.repoRoot, paths.pluginRoot, 'Plugin root');
  assertSafeChild(
    paths.repoRoot,
    paths.configPath,
    'Local plugin configuration',
  );
  assertSafeChild(paths.repoRoot, paths.sourceIconPath, 'Plugin source icon');
  assertSafeChild(paths.pluginRoot, paths.skillsRoot, 'Bundled skills');
  for (const [label, path] of [
    ['Plugin manifest template', paths.templatePath],
    ['Plugin manifest', paths.manifestPath],
    ['App manifest', paths.appPath],
    ['Plugin icon', paths.iconPath],
  ]) {
    assertSafeChild(paths.pluginRoot, path, label);
  }
  await validatePluginSourceAtPaths(paths);

  const resolvedAppId = await resolveAppId({
    explicitAppId: appId,
    environment,
    configPath: paths.configPath,
  });
  const template = await readJson(paths.templatePath, 'Plugin manifest template');
  if (
    template === null
    || Array.isArray(template)
    || typeof template !== 'object'
    || template.name !== PLUGIN_NAME
  ) {
    throw new Error('Plugin manifest template identity is invalid.');
  }
  if (template.license !== PLUGIN_LICENSE) {
    throw new Error(`Plugin manifest template license must be ${PLUGIN_LICENSE}.`);
  }

  const resolvedCachebuster =
    cachebuster ?? environment.QS_PLUGIN_CACHEBUSTER ?? defaultCachebuster(now);
  const version = createPluginVersion(template.version, resolvedCachebuster);
  const starterPrompts = template.interface?.defaultPrompt;
  if (
    !Array.isArray(starterPrompts)
    || starterPrompts.length !== 3
    || new Set(starterPrompts).size !== 3
    || starterPrompts.some(
      prompt =>
        typeof prompt !== 'string'
        || prompt !== prompt.trim()
        || prompt.length === 0
        || prompt.length > 128,
    )
  ) {
    throw new Error(
      'Plugin manifest template must declare exactly three distinct starter prompts of at most 128 characters.',
    );
  }

  const manifest = { ...template, version };
  const appManifest = {
    apps: {
      [PLUGIN_NAME]: {
        id: resolvedAppId,
      },
    },
  };

  await readFile(paths.sourceIconPath);
  await writeJsonAtomic(paths.appPath, appManifest, 0o600);
  await copyFileAtomic(paths.sourceIconPath, paths.iconPath);
  await writeJsonAtomic(paths.manifestPath, manifest);

  return {
    pluginRoot: paths.pluginRoot,
    manifestPath: paths.manifestPath,
    appPath: paths.appPath,
    iconPath: paths.iconPath,
    version,
  };
}

function assertObjectWithKeys(value, expectedKeys, label) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${label} must be an object.`);
  }
  if (expectedKeys !== undefined) {
    const actualKeys = Object.keys(value).sort();
    const normalizedExpectedKeys = [...expectedKeys].sort();
    if (!isDeepStrictEqual(actualKeys, normalizedExpectedKeys)) {
      throw new Error(`${label} has unsupported or missing fields.`);
    }
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

async function parseYamlObject(contents, label) {
  const { parseDocument } = await import('yaml');
  const document = parseDocument(contents, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(`${label} is not valid YAML.`);
  }
  return assertObjectWithKeys(document.toJS(), undefined, label);
}

async function requireDirectory(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} does not exist.`);
    }
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
}

async function requireRegularFile(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} does not exist.`);
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
}

async function validateBundledSkillStructure(paths) {
  assertSafeChild(paths.repoRoot, paths.pluginRoot, 'Plugin root');
  assertSafeChild(paths.pluginRoot, paths.skillsRoot, 'Bundled skills');
  await requireDirectory(paths.skillsRoot, 'Bundled skills');
  const entries = await readdir(paths.skillsRoot, { withFileTypes: true });
  if (entries.some(entry => !entry.isDirectory() || entry.isSymbolicLink())) {
    throw new Error('Bundled skills must contain only real skill directories.');
  }
  const actualNames = entries.map(entry => entry.name).sort();
  const expectedNames = [...BUNDLED_SKILL_NAMES].sort();
  if (!isDeepStrictEqual(actualNames, expectedNames)) {
    throw new Error('Bundled skill set is incomplete or unexpected.');
  }

  const skillPaths = BUNDLED_SKILL_NAMES.map(
    skillName => skillPathsFor(paths, skillName),
  );
  for (const skill of skillPaths) {
    const label = `Bundled skill ${skill.skillName}`;
    assertSafeChild(paths.skillsRoot, skill.skillRoot, label);
    assertSafeChild(skill.skillRoot, skill.skillPath, `${label} instructions`);
    assertSafeChild(
      skill.skillRoot,
      skill.agentPath,
      `${label} agent configuration`,
    );
    await Promise.all([
      requireDirectory(skill.skillRoot, label),
      requireRegularFile(skill.skillPath, `${label} instructions`),
      requireRegularFile(skill.agentPath, `${label} agent configuration`),
    ]);
  }
  return skillPaths;
}

async function snapshotRegularTree(root, label) {
  await requireDirectory(root, label);
  const snapshot = {
    directories: [],
    files: new Map(),
  };

  async function visit(directory, relativeDirectory = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = join(relativeDirectory, entry.name);
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`${label} must not contain symbolic links.`);
      }
      if (entry.isDirectory()) {
        snapshot.directories.push(relativePath);
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        snapshot.files.set(relativePath, await readFile(absolutePath));
      } else {
        throw new Error(`${label} must contain only regular files and directories.`);
      }
    }
  }

  await visit(root);
  return snapshot;
}

async function validatePluginSourceAtPaths(paths) {
  const bundledSkills = await validateBundledSkillStructure(paths);
  await snapshotRegularTree(paths.skillsRoot, 'Source bundled skills');
  const displayNames = new Set();
  for (const skillPaths of bundledSkills) {
    const label = `Bundled skill ${skillPaths.skillName}`;
    const [skillContents, agentContents] = await Promise.all([
      readFile(skillPaths.skillPath, 'utf8'),
      readFile(skillPaths.agentPath, 'utf8'),
    ]);
    const frontmatterMatch =
      /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skillContents);
    if (!frontmatterMatch) {
      throw new Error(`${label} frontmatter is missing or malformed.`);
    }
    const frontmatter = assertObjectWithKeys(
      await parseYamlObject(
        frontmatterMatch[1],
        `${label} frontmatter`,
      ),
      ['name', 'description'],
      `${label} frontmatter`,
    );
    const description = assertNonEmptyString(
      frontmatter.description,
      `${label} description`,
    );
    if (
      frontmatter.name !== skillPaths.skillName
      || description.length > 1024
      || description.includes('<')
      || description.includes('>')
    ) {
      throw new Error(`${label} identity is invalid.`);
    }

    const agent = assertObjectWithKeys(
      await parseYamlObject(agentContents, `${label} agent configuration`),
      ['interface', 'dependencies', 'policy'],
      `${label} agent configuration`,
    );
    const interfaceConfig = assertObjectWithKeys(
      agent.interface,
      ['display_name', 'short_description', 'default_prompt'],
      `${label} interface`,
    );
    const displayName = assertNonEmptyString(
      interfaceConfig.display_name,
      `${label} display name`,
    );
    if (displayNames.has(displayName)) {
      throw new Error('Bundled skill display names must be unique.');
    }
    displayNames.add(displayName);
    const shortDescription = assertNonEmptyString(
      interfaceConfig.short_description,
      `${label} short description`,
    );
    if (shortDescription.length < 25 || shortDescription.length > 64) {
      throw new Error(`${label} short description must contain 25-64 characters.`);
    }
    const defaultPrompt = assertNonEmptyString(
      interfaceConfig.default_prompt,
      `${label} default prompt`,
    );
    const referencedSkills = defaultPrompt.match(/\$[a-z0-9-]+/g) ?? [];
    if (
      referencedSkills.length !== 1
      || referencedSkills[0] !== `$${skillPaths.skillName}`
    ) {
      throw new Error(`${label} default prompt must name the skill.`);
    }

    const dependencies = assertObjectWithKeys(
      agent.dependencies,
      ['tools'],
      `${label} dependencies`,
    );
    if (!Array.isArray(dependencies.tools) || dependencies.tools.length !== 1) {
      throw new Error(`${label} must declare exactly one MCP dependency.`);
    }
    const [tool] = dependencies.tools;
    assertObjectWithKeys(
      tool,
      ['type', 'value', 'description', 'transport', 'url'],
      `${label} MCP dependency`,
    );
    assertNonEmptyString(
      tool.description,
      `${label} MCP dependency description`,
    );
    if (
      tool.type !== 'mcp'
      || tool.value !== PLUGIN_NAME
      || tool.transport !== 'streamable_http'
      || tool.url !== 'https://quantified-self.io/mcp'
    ) {
      throw new Error(`${label} MCP dependency is invalid.`);
    }

    const policy = assertObjectWithKeys(
      agent.policy,
      ['allow_implicit_invocation'],
      `${label} policy`,
    );
    if (policy.allow_implicit_invocation !== true) {
      throw new Error(`${label} must allow implicit invocation.`);
    }
  }
}

export async function validatePluginSource({
  repoRoot = DEFAULT_REPO_ROOT,
} = {}) {
  await validatePluginSourceAtPaths(pathsFor(repoRoot));
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

export function createCodexEnvironment({
  environment = process.env,
  codexHome,
} = {}) {
  const childEnvironment = { ...environment };
  for (const key of Object.keys(childEnvironment)) {
    if (
      key.toUpperCase() === 'QS_CHATGPT_APP_ID'
      || key.toUpperCase() === 'QS_PLUGIN_CACHEBUSTER'
    ) {
      delete childEnvironment[key];
    }
  }
  if (codexHome) {
    childEnvironment.CODEX_HOME = codexHome;
  }
  return childEnvironment;
}

function runCodex(paths, args, { codexHome, secrets = [] } = {}) {
  if (!existsSync(paths.codexPath)) {
    throw new Error('Codex plugin tooling is not installed. Run npm run plugin:setup.');
  }
  const result = spawnSync(process.execPath, [paths.codexPath, ...args], {
    cwd: paths.repoRoot,
    encoding: 'utf8',
    env: createCodexEnvironment({ codexHome }),
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Codex CLI failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    let detail = `${result.stderr || result.stdout || ''}`.trim();
    for (const secret of secrets) {
      if (secret) {
        detail = detail.split(secret).join('[redacted]');
      }
    }
    throw new Error(
      detail
        ? `Codex CLI exited with status ${result.status}: ${detail}`
        : `Codex CLI exited with status ${result.status}.`,
    );
  }
  return result;
}

function normalizePathForComparison(path) {
  const resolved = resolve(path);
  let existingAncestor = resolved;
  const missingSegments = [];
  while (true) {
    try {
      return join(realpathSync.native(existingAncestor), ...missingSegments);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return resolved;
      }
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) {
        return resolved;
      }
      missingSegments.unshift(basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

export function pathsAreEquivalent(firstPath, secondPath) {
  return (
    normalizePathForComparison(firstPath)
    === normalizePathForComparison(secondPath)
  );
}

export function classifyMarketplaceRegistration(marketplaces, repoRoot) {
  if (!Array.isArray(marketplaces)) {
    throw new Error('Codex returned an invalid marketplace listing.');
  }
  const normalizedRoot = normalizePathForComparison(repoRoot);
  for (const marketplace of marketplaces) {
    if (
      marketplace === null
      || typeof marketplace !== 'object'
      || typeof marketplace.name !== 'string'
      || typeof marketplace.root !== 'string'
    ) {
      throw new Error('Codex returned an invalid marketplace entry.');
    }
  }
  const matchingNames = marketplaces.filter(
    (marketplace) => marketplace.name === MARKETPLACE_NAME,
  );
  if (matchingNames.length > 1) {
    throw new Error(`Marketplace ${MARKETPLACE_NAME} is registered more than once.`);
  }
  const [byName] = matchingNames;
  if (byName) {
    if (!pathsAreEquivalent(byName.root, normalizedRoot)) {
      throw new Error(
        `Marketplace ${MARKETPLACE_NAME} already points to a different repository.`,
      );
    }
    return 'existing';
  }
  const matchingRoots = marketplaces.filter(
    (marketplace) => pathsAreEquivalent(marketplace.root, normalizedRoot),
  );
  if (matchingRoots.length > 1) {
    throw new Error('This repository is registered as more than one marketplace.');
  }
  const [byRoot] = matchingRoots;
  if (byRoot) {
    throw new Error(
      `This repository is already registered as marketplace ${byRoot.name}.`,
    );
  }
  return 'add';
}

export function assertInstalledPluginResult(installed, expectedVersion) {
  if (
    installed === null
    || typeof installed !== 'object'
    || installed.pluginId !== `${PLUGIN_NAME}@${MARKETPLACE_NAME}`
    || installed.version !== expectedVersion
    || typeof installed.installedPath !== 'string'
    || !installed.installedPath
  ) {
    throw new Error('Codex installed an unexpected plugin result.');
  }
  return installed;
}

export async function validateInstalledPluginBundle({
  repoRoot = DEFAULT_REPO_ROOT,
  installedPath,
  expectedVersion,
  appId,
}) {
  const paths = pathsFor(repoRoot);
  const [
    installedManifest,
    sourceManifest,
    installedApp,
    sourceApp,
    installedSkills,
    sourceSkills,
    installedIcon,
    sourceIcon,
  ] = await Promise.all([
    readJson(
      join(installedPath, '.codex-plugin', 'plugin.json'),
      'Installed plugin manifest',
    ),
    readJson(paths.manifestPath, 'Generated plugin manifest'),
    readJson(join(installedPath, '.app.json'), 'Installed app manifest'),
    readJson(paths.appPath, 'Generated app manifest'),
    snapshotRegularTree(
      join(installedPath, 'skills'),
      'Installed bundled skills',
    ),
    snapshotRegularTree(paths.skillsRoot, 'Source bundled skills'),
    readFile(join(installedPath, 'assets', 'quantified-self.png')),
    readFile(paths.sourceIconPath),
  ]);
  if (
    !isDeepStrictEqual(installedManifest, sourceManifest)
    || !isDeepStrictEqual(installedApp, sourceApp)
    || installedManifest.name !== PLUGIN_NAME
    || installedManifest.version !== expectedVersion
    || installedManifest.apps !== './.app.json'
    || installedManifest.skills !== './skills/'
    || installedApp.apps?.[PLUGIN_NAME]?.id !== appId
    || !isDeepStrictEqual(installedSkills, sourceSkills)
    || !installedIcon.equals(sourceIcon)
  ) {
    throw new Error('The installed plugin bundle is incomplete or inconsistent.');
  }
}

export async function validateWithCodex({
  repoRoot = DEFAULT_REPO_ROOT,
  expectedVersion,
  appId,
} = {}) {
  const paths = pathsFor(repoRoot);
  await validatePluginSourceAtPaths(paths);
  const isolatedHome = await mkdtemp(join(tmpdir(), 'quantified-self-plugin-'));
  try {
    const addMarketplace = parseJsonOutput(
      runCodex(paths, ['plugin', 'marketplace', 'add', paths.repoRoot, '--json'], {
        codexHome: isolatedHome,
        secrets: [appId],
      }),
      'Marketplace installation',
    );
    if (
      addMarketplace.marketplaceName !== MARKETPLACE_NAME
      || !pathsAreEquivalent(addMarketplace.installedRoot, paths.repoRoot)
    ) {
      throw new Error('Codex registered an unexpected marketplace.');
    }

    const available = parseJsonOutput(
      runCodex(paths, ['plugin', 'list', '--available', '--json'], {
        codexHome: isolatedHome,
        secrets: [appId],
      }),
      'Plugin discovery',
    );
    const candidate = available.available?.find(
      (plugin) => plugin.pluginId === `${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
    );
    if (!candidate || candidate.version !== expectedVersion) {
      throw new Error('Codex did not discover the expected plugin version.');
    }

    const installed = assertInstalledPluginResult(
      parseJsonOutput(
        runCodex(
          paths,
          ['plugin', 'add', `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, '--json'],
          { codexHome: isolatedHome, secrets: [appId] },
        ),
        'Plugin installation',
      ),
      expectedVersion,
    );
    assertSafeChild(isolatedHome, installed.installedPath, 'Installed plugin');
    await validateInstalledPluginBundle({
      repoRoot: paths.repoRoot,
      installedPath: installed.installedPath,
      expectedVersion,
      appId,
    });

    const listed = parseJsonOutput(
      runCodex(paths, ['plugin', 'list', '--json'], {
        codexHome: isolatedHome,
        secrets: [appId],
      }),
      'Installed plugin listing',
    );
    const enabled = listed.installed?.find(
      (plugin) => plugin.pluginId === `${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
    );
    if (!enabled?.installed || !enabled.enabled || enabled.version !== expectedVersion) {
      throw new Error('Codex did not report the plugin as installed and enabled.');
    }
    return { version: expectedVersion };
  } finally {
    await rm(isolatedHome, { recursive: true, force: true });
  }
}

async function ensureMarketplace(paths, appId) {
  const result = parseJsonOutput(
    runCodex(paths, ['plugin', 'marketplace', 'list', '--json'], {
      secrets: [appId],
    }),
    'Marketplace listing',
  );
  if (classifyMarketplaceRegistration(result.marketplaces, paths.repoRoot) === 'existing') {
    return;
  }
  runCodex(paths, ['plugin', 'marketplace', 'add', paths.repoRoot, '--json'], {
    secrets: [appId],
  });
}

async function installLocally(paths, appId, expectedVersion) {
  const installed = assertInstalledPluginResult(
    parseJsonOutput(
      runCodex(
        paths,
        ['plugin', 'add', `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, '--json'],
        { secrets: [appId] },
      ),
      'Local plugin installation',
    ),
    expectedVersion,
  );
  await validateInstalledPluginBundle({
    repoRoot: paths.repoRoot,
    installedPath: installed.installedPath,
    expectedVersion,
    appId,
  });
  return installed;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    const allowedArguments =
      command === 'configure'
        ? ['--repo-root']
        : ['--cachebuster', '--repo-root'];
    if (!allowedArguments.includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}.`);
    }
    index += 1;
    if (argument === '--cachebuster') {
      options.cachebuster = value;
    } else {
      options.repoRoot = value;
    }
  }
  return { command, options };
}

async function runCommand(argv) {
  const { command, options } = parseArguments(argv);
  if (command === 'configure') {
    const configured = await configurePlugin(options);
    console.log(`Saved local plugin configuration at ${configured.configPath}.`);
    return;
  }

  if (!['build', 'validate', 'setup', 'sync'].includes(command)) {
    throw new Error(
      'Usage: plugin-tool.mjs <configure|build|validate|setup|sync> [--cachebuster TOKEN] [--repo-root PATH]',
    );
  }

  const paths = pathsFor(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const resolvedAppId = await resolveAppId({
    explicitAppId: options.appId,
    environment: process.env,
    configPath: paths.configPath,
  });
  const built = await buildPlugin({ ...options, appId: resolvedAppId });
  console.log(`Built ${PLUGIN_NAME} ${built.version}.`);
  if (command === 'build') {
    return;
  }

  await validateWithCodex({
    repoRoot: paths.repoRoot,
    expectedVersion: built.version,
    appId: resolvedAppId,
  });
  console.log(`Validated ${PLUGIN_NAME} with an isolated Codex profile.`);
  if (command === 'validate') {
    return;
  }

  await ensureMarketplace(paths, resolvedAppId);
  const installed = await installLocally(paths, resolvedAppId, built.version);
  console.log(`Installed ${installed.pluginId} ${installed.version}.`);
  console.log(
    'Restart the ChatGPT desktop app if it is open, then test the plugin in a new ChatGPT or Codex conversation.',
  );
}

const isMainModule =
  process.argv[1] !== undefined
  && pathsAreEquivalent(fileURLToPath(import.meta.url), process.argv[1]);

if (isMainModule) {
  runCommand(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Plugin command failed.');
    process.exitCode = 1;
  });
}
