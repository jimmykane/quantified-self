import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { createIdResolver, DevEnvironment, loadConfigFromFile, mergeConfig, resolveConfig } from 'vite';

export const reasonsFile = 'tools/frontend-test-environment-reasons.json';
const weight = { 'helpers-node': 0, 'helpers-dom': 1, angular: 2 };
const forbidden = /^(?:@angular\/[^/]+\/(?:[^/]+\/)*testing(?:\/|$)|@angular\/compiler(?:-cli)?(?:\/|$)|@analogjs\/(?:vitest-angular|vite-plugin-angular)(?:\/|$)|zone\.js(?:\/|$))/;
const moduleCalls = new Set(['importActual', 'importMock', 'mock', 'doMock', 'requireActual', 'requireMock']);
// Match Vite's exact asset query flags; ?raw=1 and ?url=1 still execute source.
const dataImport = /[?&](?:raw|url)(?:&|$)/;

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression
    && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
}

export function isExplicitOrdinarySpec(file) {
  return typeof file === 'string' && /^[a-zA-Z0-9._/-]+\.spec\.ts$/.test(file)
    && !file.split('/').some(part => !part || part === '.' || part === '..' || part === 'node_modules')
    && !/^(?:functions|node_modules)\//.test(file)
    && !['src/firestore.rules.spec.ts', 'src/storage.rules.spec.ts'].includes(file);
}

function runtimeImports(source) {
  const imports = [];
  function visit(node) {
    let module;
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const clause = node.importClause;
      if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)
        || clause.namedBindings.elements.length === 0
        || clause.namedBindings.elements.some(item => !item.isTypeOnly)) module = node.moduleSpecifier;
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly
      && ts.isExternalModuleReference(node.moduleReference)) {
      module = node.moduleReference.expression;
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      if (!node.exportClause || !ts.isNamedExports(node.exportClause)
        || node.exportClause.elements.length === 0
        || node.exportClause.elements.some(item => !item.isTypeOnly)) module = node.moduleSpecifier;
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === 'require'
      || moduleCalls.has(memberName(node.expression)))) module = node.arguments[0];
    if (module && ts.isStringLiteralLike(module)) imports.push(module.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}

function sharedFixtureSetup(source) {
  const hooks = new Set(['beforeEach', 'beforeAll']);
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'vitest'
      && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const item of node.importClause.namedBindings.elements) {
        if (hooks.has(item.propertyName?.text ?? item.name.text)) hooks.add(item.name.text);
      }
    }
  }
  let found = false;
  function renders(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ['createComponent', 'detectChanges'].includes(node.expression.name.text)) found = true;
    ts.forEachChild(node, renders);
  }
  function visit(node) {
    if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && hooks.has(node.expression.text)
      || ts.isPropertyAccessExpression(node.expression) && hooks.has(node.expression.name.text))) {
      for (const argument of node.arguments) {
        if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) renders(argument.body);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

export async function checkPolicy({ root, specs, baseFiles, baseRegistry, reasons, changedFiles = [] }) {
  root = realpathSync(root);
  const errors = [];
  const warnings = [];
  const projects = new Map(specs.map(spec => [spec.file, spec.project]));
  const existing = new Set(baseFiles);
  const changed = new Set(changedFiles);
  assert(reasons && typeof reasons === 'object' && !Array.isArray(reasons), 'Expected an environment reason map');
  assert.deepEqual(Object.keys(reasons), Object.keys(reasons).sort(), 'Environment reasons must be sorted by exact spec path');
  for (const [file, entry] of Object.entries(reasons)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).sort().join(',') !== 'environment,reason'
      || !['helpers-dom', 'angular'].includes(entry.environment)
      || typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      errors.push(`${file}: record environment (helpers-dom/angular) and a concrete reason of at least 20 characters in ${reasonsFile}`);
    } else if (projects.get(file) !== entry.environment) {
      errors.push(`${file}: stale or mismatched environment reason (${entry.environment}); remove or update it`);
    }
  }
  const oldNode = new Set(baseRegistry.node ?? []);
  const oldDom = new Set(baseRegistry.dom ?? []);
  const cache = new Map();
  const configFile = resolve(root, 'vitest.config.ts');
  const loaded = existsSync(configFile) ? await loadConfigFromFile({ command: 'serve', mode: 'test' }, configFile) : null;
  const resolvers = new Map();
  async function runtimeResolver(project) {
    if (!resolvers.has(project)) {
      const selected = loaded?.config.test?.projects?.find(item => item.test?.name === project);
      if (loaded) assert(selected, `Missing inline frontend project: ${project}`);
      const resolution = loaded
        ? mergeConfig({ resolve: loaded.config.resolve ?? {} }, { resolve: selected.resolve ?? {} }).resolve
        : { alias: { '@shared': resolve(root, 'shared'), app: resolve(root, 'src/app') } };
      const config = await resolveConfig({ root, configFile: false, envFile: false, logLevel: 'silent', resolve: resolution,
        environments: { ssr: { optimizeDeps: { noDiscovery: true, include: [] } } } }, 'serve', 'test');
      // Resolve imports without starting a server, optimizer, or Angular/test setup.
      const environment = new DevEnvironment('ssr', config, { hot: false });
      await environment.init();
      const resolveId = createIdResolver(config);
      resolvers.set(project, { environment, resolveId: (id, importer, aliasOnly = false) => resolveId(environment, id, importer, aliasOnly) });
    }
    return resolvers.get(project).resolveId;
  }
  function parse(file) {
    if (!cache.has(file)) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      assert.equal(source.parseDiagnostics.length, 0, `Cannot inspect invalid source: ${relative(root, file)}`);
      cache.set(file, { source, imports: runtimeImports(source) });
    }
    return cache.get(file);
  }
  try {
    for (const { file, project } of specs) {
      assert(Object.hasOwn(weight, project), `Unknown frontend project: ${project}`);
      const isNew = !existing.has(file);
      const previous = oldNode.has(file) ? 'helpers-node' : oldDom.has(file) ? 'helpers-dom' : 'angular';
      const heavier = !isNew && weight[project] > weight[previous];
      if ((isNew && project === 'angular' || heavier) && reasons[file]?.environment !== project) {
        errors.push(`${file}: ${isNew ? 'new Angular spec needs explicit classification' : `moving ${previous} to ${project} needs review`}; record its concrete reason in ${reasonsFile} (or register a verified Node/DOM spec in tools/frontend-test-environments.json)`);
      }
      if (project === 'angular') {
        if ((isNew || changed.has(file)) && sharedFixtureSetup(parse(resolve(root, file)).source)) {
          warnings.push(`${file}: shared beforeEach/beforeAll creates or renders a fixture; review whether all tests need it and move setup into the tests that do`);
        }
        continue;
      }
      const resolveId = await runtimeResolver(project);
      const visited = new Set();
      async function walk(path) {
        if (visited.has(path)) return;
        visited.add(path);
        for (const specifier of parse(path).imports) {
          if (dataImport.test(specifier)) continue;
          const module = forbidden.test(specifier) ? specifier : await resolveId(specifier, path, true) ?? specifier;
          if (forbidden.test(module)) {
            const name = module === specifier ? specifier : `${specifier} (alias for ${module})`;
            errors.push(`${file}: ${relative(root, path)} imports ${name}; Node/DOM suites must not load Angular testing/compiler/global setup`);
            continue;
          }
          const target = await resolveId(specifier, path);
          if (!target || target.includes('/node_modules/') || dataImport.test(target)) continue;
          const runtime = target.replace(/[?#].*$/, '');
          if (!/\.[cm]?[jt]sx?$/.test(runtime) || /\.d\.[cm]?ts$/.test(runtime)) continue;
          const local = relative(root, runtime).replaceAll('\\', '/');
          if (local === 'src/test-setup.ts') errors.push(`${file}: ${relative(root, path)} imports src/test-setup.ts; keep global setup scoped to Angular`);
          else if (!local.startsWith('../')) await walk(runtime);
        }
      }
      await walk(resolve(root, file));
    }
  } finally {
    await Promise.all([...resolvers.values()].map(item => item.environment.close()));
  }
  return { errors, warnings };
}
