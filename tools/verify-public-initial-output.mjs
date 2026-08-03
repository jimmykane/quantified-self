import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const outputDirectory = path.resolve(process.argv[2] ?? 'dist/browser');
const indexPath = path.join(outputDirectory, 'index.html');
const prerenderManifestPath = path.join(path.dirname(outputDirectory), 'prerendered-routes.json');
const sourceMapCache = new Map();

const prerenderedPageSourcePatterns = [
  /^src\/app\/components\/home\/home\.component\.ts$/,
  /^src\/app\/components\/help\/help-page\.component\.ts$/,
  /^src\/app\/components\/policies\/policies\.component\.ts$/,
  /^src\/app\/components\/integrations\/integrations-hub-page\.component\.ts$/,
  /^src\/app\/components\/integrations\/provider-integration-page\.component\.ts$/,
  /^src\/app\/components\/features\/workout-data-comparison-page\.component\.ts$/,
  /^src\/app\/components\/public-seo\/public-seo-page\.component\.ts$/,
  /^src\/app\/components\/tools\/tools-hub-page\.component\.ts$/,
  /^src\/app\/components\/tools\/tools-compare-page\.component\.ts$/,
];

if (!fs.existsSync(indexPath)) {
  throw new Error(`Expected a production browser output at ${indexPath}. Run the production build first.`);
}

const indexHtml = fs.readFileSync(indexPath, 'utf8');
const indexedJavaScriptAssets = collectAssets(indexHtml, '.js');
const initialStylesheets = collectAssets(indexHtml, '.css');
const applicationAssets = findAssetsContainingSource(/^src\/app\/app\.module\.ts$/);
const homeRouteAssets = findAssetsContainingSource(/^src\/app\/components\/home\/home\.component\.ts$/);
const prerenderedRouteAssets = prerenderedPageSourcePatterns.flatMap(findAssetsContainingSource);
const homeStartupJavaScriptAssets = collectStaticDependencyGraph([
  ...indexedJavaScriptAssets,
  ...applicationAssets,
  ...homeRouteAssets,
]);
const publicStartupJavaScriptAssets = collectStaticDependencyGraph([
  ...indexedJavaScriptAssets,
  ...applicationAssets,
  ...prerenderedRouteAssets,
]);
const homeStartupSourceRecords = uniqueSourceRecords(homeStartupJavaScriptAssets.flatMap(readSourceRecords));
const publicStartupSourceRecords = uniqueSourceRecords(publicStartupJavaScriptAssets.flatMap(readSourceRecords));

assertNoHomeStartupSource(
  'route-only public page content',
  /^src\/app\/components\/(?:features\/workout-data-comparison-page|integrations\/integration-pages|public-seo\/public-seo-pages)\.content\.ts$/,
);
assertNoHomeStartupSource(
  'unused event data runtime',
  /^src\/app\/services\/app\.event\.service\.ts$/,
);
assertNoHomeStartupSource(
  'route-only legal policy content',
  /^src\/app\/shared\/policies\.content\.ts$/,
);
assertNoHomeStartupSource(
  'private route-detail hydration runtime',
  /^src\/app\/(?:resolvers\/route\.resolver|services\/app\.(?:file|original-file-hydration|route|route-hydration)\.service)\.ts$/,
);
assertNoHomeStartupSource(
  'admin-only service runtime',
  /^src\/app\/services\/admin\.service\.ts$/,
);
assertNoStartupSource('Mapbox', /(?:^|\/)(?:mapbox-gl|mapbox-loader)(?:[./]|$)/);
assertNoStartupSource('dashboard upload UI', /\/components\/(?:dashboard\/dashboard-header-upload|upload\/upload-activities)\//);
assertNoStartupSource(
  'broad shared or Material module',
  /^src\/app\/modules\/(?:shared|material)\.module\.ts$/,
);
assertNoStartupSource(
  'route-only onboarding and pricing UI',
  /\/components\/(?:onboarding\/onboarding|pricing\/pricing)\.component\.ts$/,
);
assertNoStartupSource(
  "interaction-only What's New UI",
  /\/components\/whats-new\/whats-new-(?:dialog|feed|item)\.component\.ts$/,
);
assertNoStartupSource(
  'capability-failure browser upgrade UI',
  /\/components\/browser-upgrade-dialog\/browser-upgrade-dialog\.component\.ts$/,
);
assertNoStartupSource(
  'interaction-only comparison UI',
  /\/components\/(?:benchmark\/benchmark-(?:bottom-sheet|selection-dialog)|confirmation-dialog\/confirmation-dialog|event-tags\/event-tags-dialog|tools\/device-color-preferences-dialog)\.component\.ts$/,
);
assertNoInitialStylesheet('Mapbox', /mapboxgl-/);
assertPrerenderedDocuments();

const homeStartupBytes = homeStartupJavaScriptAssets.reduce((total, asset) => (
  total + fs.statSync(path.join(outputDirectory, asset)).size
), 0);
const publicStartupBytes = publicStartupJavaScriptAssets.reduce((total, asset) => (
  total + fs.statSync(path.join(outputDirectory, asset)).size
), 0);
const sportsLibBaseline = sourceBaseline(homeStartupSourceRecords, /@sports-alliance\/sports-lib/);
const authBaseline = sourceBaseline(
  homeStartupSourceRecords,
  /(?:^|\/)(?:src\/app\/authentication|node_modules\/(?:@angular\/fire|@firebase|firebase))(?:\/|$)/,
);

console.log(`Verified prerendered public startup union: ${publicStartupJavaScriptAssets.length} JS assets, ${formatBytes(publicStartupBytes)} raw.`);
console.log(`Home startup baseline: ${homeStartupJavaScriptAssets.length} JS assets, ${formatBytes(homeStartupBytes)} raw.`);
console.log(`Home Sports Lib baseline: ${sportsLibBaseline.count} source module(s), ${formatBytes(sportsLibBaseline.bytes)} source bytes.`);
console.log(`Home auth/Firebase baseline: ${authBaseline.count} source module(s), ${formatBytes(authBaseline.bytes)} source bytes.`);

function collectAssets(html, extension) {
  const assetPattern = new RegExp(`(?:src|href)="([^\"]+\\${extension})"`, 'g');
  return [...html.matchAll(assetPattern)]
    .map((match) => match[1])
    .filter((asset) => asset && !asset.startsWith('assets/'));
}

function readSourceRecords(asset) {
  const sourceMap = readSourceMap(asset);
  return (sourceMap.sources ?? []).map((source, index) => ({
    source,
    content: sourceMap.sourcesContent?.[index] ?? '',
  }));
}

function readSourceMap(asset) {
  const cachedSourceMap = sourceMapCache.get(asset);
  if (cachedSourceMap) {
    return cachedSourceMap;
  }

  const sourceMapPath = path.join(outputDirectory, `${asset}.map`);
  if (!fs.existsSync(sourceMapPath)) {
    throw new Error(`Expected hidden source map for startup asset ${asset}.`);
  }

  const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
  sourceMapCache.set(asset, sourceMap);
  return sourceMap;
}

function findAssetsContainingSource(sourcePattern) {
  const assets = fs.readdirSync(outputDirectory)
    .filter((asset) => asset.endsWith('.js.map'))
    .map((sourceMapAsset) => sourceMapAsset.slice(0, -'.map'.length))
    .filter((asset) => (
      (readSourceMap(asset).sources ?? []).some((source) => sourcePattern.test(source))
    ));

  if (assets.length === 0) {
    throw new Error(`Could not locate a browser asset containing source ${sourcePattern}.`);
  }

  return assets;
}

function collectStaticDependencyGraph(seedAssets) {
  const assets = new Set();
  const queue = [...new Set(seedAssets)];

  while (queue.length > 0) {
    const asset = queue.shift();
    if (!asset || assets.has(asset)) {
      continue;
    }
    assets.add(asset);

    const assetPath = path.join(outputDirectory, asset);
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Startup asset ${asset} does not exist.`);
    }

    const source = fs.readFileSync(assetPath, 'utf8');
    const staticImportPattern = /\b(?:import|export)(?!\s*\()\s*(?:[^"'();]*?from\s*)?["']\.\/([^"']+\.js)["']/g;
    for (const match of source.matchAll(staticImportPattern)) {
      queue.push(match[1]);
    }
  }

  return [...assets].sort();
}

function uniqueSourceRecords(records) {
  return [...new Map(records.map((record) => [record.source, record])).values()];
}

function assertNoStartupSource(label, pattern) {
  const matches = publicStartupSourceRecords.filter(({ source }) => pattern.test(source));
  if (matches.length > 0) {
    throw new Error(`${label} leaked into a prerendered public startup graph: ${matches.map(({ source }) => source).join(', ')}`);
  }
}

function assertNoHomeStartupSource(label, pattern) {
  const matches = homeStartupSourceRecords.filter(({ source }) => pattern.test(source));
  if (matches.length > 0) {
    throw new Error(`${label} leaked into the home startup graph: ${matches.map(({ source }) => source).join(', ')}`);
  }
}

function assertNoInitialStylesheet(label, pattern) {
  for (const asset of initialStylesheets) {
    const stylesheet = fs.readFileSync(path.join(outputDirectory, asset), 'utf8');
    if (pattern.test(stylesheet)) {
      throw new Error(`${label} stylesheet leaked into the public initial output: ${asset}`);
    }
  }
}

function assertPrerenderedDocuments() {
  const documentPaths = collectIndexDocuments(outputDirectory);
  const actualRoutes = documentPaths.map(routeForDocument);
  const expectedRoutes = readPrerenderedRoutes();
  const actualRouteSet = new Set(actualRoutes);
  const expectedRouteSet = new Set(expectedRoutes);
  const missingRoutes = expectedRoutes.filter(route => !actualRouteSet.has(route));
  const unexpectedRoutes = actualRoutes.filter(route => !expectedRouteSet.has(route));

  if (missingRoutes.length > 0 || unexpectedRoutes.length > 0) {
    const details = [
      missingRoutes.length > 0 ? `missing: ${missingRoutes.join(', ')}` : '',
      unexpectedRoutes.length > 0 ? `unexpected: ${unexpectedRoutes.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Prerendered browser documents do not match the generated route manifest (${details}).`);
  }

  for (const documentPath of documentPaths) {
    const route = routeForDocument(documentPath);
    const dom = new JSDOM(fs.readFileSync(documentPath, 'utf8'));
    const documentRef = dom.window.document;

    assertDocumentValue(route, 'title', documentRef.title);
    assertDocumentValue(
      route,
      'meta description',
      documentRef.querySelector('meta[name="description"]')?.getAttribute('content'),
    );
    assertDocumentValue(route, 'H1', documentRef.querySelector('h1')?.textContent);

    if (!documentRef.querySelector('footer.public-footer')) {
      throw new Error(`Prerendered route ${route} is missing the public footer.`);
    }

    const jsonLdScripts = [...documentRef.querySelectorAll('script[type="application/ld+json"]')];
    if (jsonLdScripts.length === 0) {
      throw new Error(`Prerendered route ${route} is missing JSON-LD.`);
    }
    for (const script of jsonLdScripts) {
      try {
        JSON.parse(script.textContent ?? '');
      } catch (error) {
        throw new Error(`Prerendered route ${route} contains invalid JSON-LD.`, { cause: error });
      }
    }

    dom.window.close();
  }

  console.log(
    `Verified ${documentPaths.length} prerendered pages: title, description, H1, valid JSON-LD, and public footer.`,
  );
}

function readPrerenderedRoutes() {
  if (!fs.existsSync(prerenderManifestPath)) {
    throw new Error(`Expected a prerender route manifest at ${prerenderManifestPath}. Run the production build first.`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(prerenderManifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse the prerender route manifest at ${prerenderManifestPath}.`, { cause: error });
  }

  if (!manifest?.routes || typeof manifest.routes !== 'object' || Array.isArray(manifest.routes)) {
    throw new Error(`Expected ${prerenderManifestPath} to contain a routes object.`);
  }

  const routes = Object.keys(manifest.routes).map(normalizeRoute);
  if (routes.length === 0) {
    throw new Error(`Expected ${prerenderManifestPath} to contain at least one route.`);
  }
  if (new Set(routes).size !== routes.length) {
    throw new Error(`Expected ${prerenderManifestPath} to contain unique normalized routes.`);
  }

  return routes.sort();
}

function normalizeRoute(route) {
  const normalizedRoute = route.trim().replace(/\/+$/, '') || '/';
  if (!normalizedRoute.startsWith('/')) {
    throw new Error(`Expected prerender route "${route}" to start with "/".`);
  }
  return normalizedRoute;
}

function collectIndexDocuments(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectIndexDocuments(entryPath);
      }
      return entry.name === 'index.html' ? [entryPath] : [];
    })
    .sort();
}

function routeForDocument(documentPath) {
  const relativeDirectory = path.relative(outputDirectory, path.dirname(documentPath));
  return relativeDirectory ? `/${relativeDirectory.split(path.sep).join('/')}` : '/';
}

function assertDocumentValue(route, label, value) {
  if (!value?.trim()) {
    throw new Error(`Prerendered route ${route} is missing its ${label}.`);
  }
}

function sourceBaseline(sourceRecords, pattern) {
  const matches = sourceRecords.filter(({ source }) => pattern.test(source));
  return {
    count: matches.length,
    bytes: matches.reduce((total, { content }) => total + Buffer.byteLength(content), 0),
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
