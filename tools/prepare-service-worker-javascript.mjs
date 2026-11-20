import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// These dynamic entries can run while bootstrapping, before a new worker controls the tab.
const bootstrapEntries = [
  'src/main.ts',
  'src/app/app.module.ts',
  'src/app/components/home/home.component.ts',
  'src/app/modules/login.module.ts',
];

export function splitServiceWorkerJavaScript(manifest, outputs, shellHtml) {
  const app = manifest.assetGroups.find(group => group.name === 'app');
  const previous = manifest.assetGroups.find(group => group.name === 'feature-js');
  const allUrls = [...app.urls, ...(previous?.urls ?? [])];
  const scripts = allUrls.filter(url => url.endsWith('.js'));
  const bundled = new Set(scripts.map(url => url.slice(1)));
  const required = new Set();
  const entries = new Set();

  function include(file) {
    if (required.has(file)) return;
    if (!bundled.has(file) || !outputs[file]) throw new Error(`Missing offline shell output: ${file}`);
    required.add(file);
    for (const dependency of outputs[file].imports) {
      if (!dependency.external && dependency.kind === 'import-statement') include(dependency.path);
    }
  }

  const document = new JSDOM(shellHtml, { url: 'https://shell.invalid/' }).window.document;
  for (const tag of document.querySelectorAll('script[src], link[rel~="modulepreload"][href]')) {
    const url = new URL(tag.src || tag.href);
    if (url.origin === document.location.origin && bundled.has(url.pathname.slice(1))) include(url.pathname.slice(1));
  }

  for (const file of bundled) {
    const output = outputs[file];
    if (!output) throw new Error(`Missing browser build metadata for ${file}`);
    const entry = output.entryPoint ?? '';
    entries.add(entry);
    if (bootstrapEntries.includes(entry)
      || entry.startsWith('node_modules/@angular/common/locales/') || entry.startsWith('node_modules/dayjs/locale/')) {
      include(file);
    }
  }
  for (const entry of bootstrapEntries) {
    if (!entries.has(entry)) throw new Error(`Missing offline bootstrap entry: ${entry}`);
  }

  const lazy = scripts.filter(url => !required.has(url.slice(1)));
  if (!lazy.length) throw new Error('Expected on-demand browser JavaScript in the release build.');
  const lazyUrls = new Set(lazy);
  const shell = { ...app, urls: allUrls.filter(url => !lazyUrls.has(url)) };
  const features = { ...app, name: 'feature-js', installMode: 'lazy', updateMode: 'lazy', urls: lazy, patterns: [] };
  const assetGroups = manifest.assetGroups.filter(group => group !== previous);
  assetGroups.splice(assetGroups.indexOf(app), 1, shell, features);
  return { ...manifest, assetGroups };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] ?? 'dist');
  const path = resolve(output, 'browser/ngsw.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const { outputs } = JSON.parse(readFileSync(resolve(output, 'stats.json'), 'utf8'));
  const html = readFileSync(resolve(output, 'browser', '.' + manifest.index), 'utf8');
  const result = splitServiceWorkerJavaScript(manifest, outputs, html);
  writeFileSync(path, JSON.stringify(result, null, 2));
  console.log(`Service worker will load ${result.assetGroups.find(group => group.name === 'feature-js').urls.length} JavaScript files on demand.`);
}
