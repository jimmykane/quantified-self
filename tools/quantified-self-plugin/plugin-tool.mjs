import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { constants as fsConstants, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

export const PLUGIN_NAME = 'quantified-self';
export const MARKETPLACE_NAME = 'quantified-self-local';

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
    marketplacePath: join(normalizedRoot, '.agents', 'plugins', 'marketplace.json'),
    configPath: join(normalizedRoot, '.local', 'quantified-self-plugin.json'),
    codexPath: join(
      normalizedRoot,
      'tools',
      'quantified-self-plugin',
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'codex.cmd' : 'codex',
    ),
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
  for (const [label, path] of [
    ['Plugin manifest', paths.manifestPath],
    ['App manifest', paths.appPath],
    ['Plugin icon', paths.iconPath],
  ]) {
    assertSafeChild(paths.pluginRoot, path, label);
  }

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

  const resolvedCachebuster =
    cachebuster ?? environment.QS_PLUGIN_CACHEBUSTER ?? defaultCachebuster(now);
  const version = createPluginVersion(template.version, resolvedCachebuster);
  const manifest = { ...template, version };
  const appManifest = {
    apps: {
      [PLUGIN_NAME]: {
        id: resolvedAppId,
      },
    },
  };

  await readFile(paths.sourceIconPath);
  await writeJsonAtomic(paths.manifestPath, manifest);
  await writeJsonAtomic(paths.appPath, appManifest, 0o600);
  await copyFileAtomic(paths.sourceIconPath, paths.iconPath);

  return {
    pluginRoot: paths.pluginRoot,
    manifestPath: paths.manifestPath,
    appPath: paths.appPath,
    iconPath: paths.iconPath,
    version,
  };
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function runCodex(paths, args, { codexHome, secrets = [] } = {}) {
  const environment = {
    ...process.env,
    ...(codexHome ? { CODEX_HOME: codexHome } : {}),
  };
  const result = spawnSync(paths.codexPath, args, {
    cwd: paths.repoRoot,
    encoding: 'utf8',
    env: environment,
    maxBuffer: 4 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  if (result.error?.code === 'ENOENT') {
    throw new Error('Codex plugin tooling is not installed. Run npm run plugin:setup.');
  }
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
    if (normalizePathForComparison(byName.root) !== normalizedRoot) {
      throw new Error(
        `Marketplace ${MARKETPLACE_NAME} already points to a different repository.`,
      );
    }
    return 'existing';
  }
  const matchingRoots = marketplaces.filter(
    (marketplace) => normalizePathForComparison(marketplace.root) === normalizedRoot,
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

export async function validateWithCodex({
  repoRoot = DEFAULT_REPO_ROOT,
  expectedVersion,
  appId,
} = {}) {
  const paths = pathsFor(repoRoot);
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
      || normalizePathForComparison(addMarketplace.installedRoot) !== paths.repoRoot
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

    const installed = parseJsonOutput(
      runCodex(
        paths,
        ['plugin', 'add', `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, '--json'],
        { codexHome: isolatedHome, secrets: [appId] },
      ),
      'Plugin installation',
    );
    if (
      installed.pluginId !== `${PLUGIN_NAME}@${MARKETPLACE_NAME}`
      || installed.version !== expectedVersion
      || typeof installed.installedPath !== 'string'
      || !installed.installedPath
    ) {
      throw new Error('Codex installed an unexpected plugin result.');
    }
    assertSafeChild(isolatedHome, installed.installedPath, 'Installed plugin');
    const installedManifest = await readJson(
      join(installed.installedPath, '.codex-plugin', 'plugin.json'),
      'Installed plugin manifest',
    );
    const installedApp = await readJson(
      join(installed.installedPath, '.app.json'),
      'Installed app manifest',
    );
    const installedSkill = await readFile(
      join(
        installed.installedPath,
        'skills',
        'analyze-quantified-self',
        'SKILL.md',
      ),
      'utf8',
    );
    const [installedIcon, sourceIcon] = await Promise.all([
      readFile(join(installed.installedPath, 'assets', 'quantified-self.png')),
      readFile(paths.sourceIconPath),
    ]);
    if (
      installedManifest.name !== PLUGIN_NAME
      || installedManifest.version !== expectedVersion
      || installedManifest.apps !== './.app.json'
      || installedManifest.skills !== './skills/'
      || installedApp.apps?.[PLUGIN_NAME]?.id !== appId
      || installedSkill.includes('[TODO')
      || !installedIcon.equals(sourceIcon)
    ) {
      throw new Error('The installed plugin bundle is incomplete or inconsistent.');
    }

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

async function installLocally(paths, appId) {
  const installed = parseJsonOutput(
    runCodex(
      paths,
      ['plugin', 'add', `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, '--json'],
      { secrets: [appId] },
    ),
    'Local plugin installation',
  );
  if (installed.pluginId !== `${PLUGIN_NAME}@${MARKETPLACE_NAME}`) {
    throw new Error('Codex installed an unexpected local plugin.');
  }
  return installed;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!['--cachebuster', '--repo-root'].includes(argument)) {
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
  const installed = await installLocally(paths, resolvedAppId);
  console.log(`Installed ${installed.pluginId} ${installed.version}.`);
  console.log('Start a new ChatGPT or Codex conversation to load the updated plugin.');
}

const isMainModule =
  process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  runCommand(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Plugin command failed.');
    process.exitCode = 1;
  });
}
