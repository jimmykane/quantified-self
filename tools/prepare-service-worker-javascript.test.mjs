import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { splitServiceWorkerJavaScript } from './prepare-service-worker-javascript.mjs';

const output = (entryPoint, imports = []) => ({ entryPoint, imports });
const link = (path, kind = 'import-statement') => ({ path, kind });
const outputs = {
  'main.js': output('src/main.ts', [link('shared.js'), link('help.js', 'dynamic-import')]),
  'polyfills.js': output('angular:polyfills'),
  'app.js': output('src/app/app.module.ts', [link('shared.js')]),
  'home.js': output('src/app/components/home/home.component.ts'),
  'login.js': output('src/app/modules/login.module.ts'),
  'locale.js': output('node_modules/@angular/common/locales/el.js', [link('intl.js')]),
  'day.js': output('node_modules/dayjs/locale/el.js'),
  'shared.js': output(undefined, [link('secondary.js')]),
  'secondary.js': output(undefined, [link('shared.js')]),
  'intl.js': output(),
  'preload.js': output(),
  'help.js': output('src/app/help.ts', [link('shared.js'), link('chart.js')]),
  'chart.js': output(),
  'worker.js': output('src/app/workers/feature.worker.ts'),
};
const html = `
  <base href="/">
  <script src="assets/theme-init.js"></script>
  <script src="https://external.example/script.js"></script>
  <script src="main.js"></script>
  <script src="polyfills.js"></script>
  <link rel="modulepreload" href="/preload.js">
`;
const urls = ['/index.csr.html', '/assets/theme-init.js', ...Object.keys(outputs).map(file => '/' + file)];
const app = { name: 'app', installMode: 'prefetch', updateMode: 'prefetch', urls, patterns: [], cacheQueryOptions: { ignoreVary: true } };
const assets = { name: 'assets', urls: ['/media/font.woff2'] };
const manifest = { assetGroups: [app, assets], hashTable: Object.fromEntries(urls.map(url => [url, 'test-hash'])), navigationUrls: [] };

test('prefetches the HTML, bootstrap, locale and static dependency graph, and keeps feature scripts hashed and lazy', () => {
  const result = splitServiceWorkerJavaScript(manifest, outputs, html);
  const [shell, features, media] = result.assetGroups;
  assert.deepEqual(features.urls, ['/help.js', '/chart.js', '/worker.js']);
  assert.equal(features.installMode, 'lazy');
  assert.equal(features.updateMode, 'lazy');
  assert.deepEqual(shell.urls, urls.filter(url => !features.urls.includes(url)));
  assert.deepEqual(shell.cacheQueryOptions, app.cacheQueryOptions);
  assert.equal(media, assets);
  assert.deepEqual(result.hashTable, manifest.hashTable);
  assert.deepEqual(result.navigationUrls, manifest.navigationUrls);
  assert.deepEqual(splitServiceWorkerJavaScript(result, outputs, html), result);
});

test('rejects incomplete build metadata before writing a release manifest', () => {
  assert.throws(() => splitServiceWorkerJavaScript(manifest, outputs, '<script src="assets/forgotten.js"></script>'), /Local shell script/);
  assert.throws(() => splitServiceWorkerJavaScript(manifest, { ...outputs, 'shared.js': undefined }, html), /Missing/);
  assert.throws(() => splitServiceWorkerJavaScript(manifest, { ...outputs, 'app.js': output('unknown') }, html), /Missing offline bootstrap/);
});

test('both Hosting builds prepare JavaScript groups before verifying the release', () => {
  const readConfig = name => JSON.parse(readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
  const { scripts } = readConfig('package.json');
  const configurations = readConfig('angular.json').projects['track-tools'].architect.build.configurations;
  for (const name of ['production', 'beta']) {
    assert.equal(configurations[name].statsJson, true);
    const steps = scripts['build-' + name].split(' && ');
    const build = steps.findIndex(step => step.includes('tools/angular-build.mjs'));
    const prepare = steps.indexOf('node tools/prepare-service-worker-javascript.mjs');
    const verify = steps.indexOf('npm run verify:service-worker-output');
    assert.ok(build >= 0 && build < prepare && prepare < verify);
  }
});
