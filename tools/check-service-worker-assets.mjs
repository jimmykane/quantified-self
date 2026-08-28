import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputDirectory = resolve(process.argv[2] ?? 'dist/browser');
const manifestPath = resolve(outputDirectory, 'ngsw.json');

if (!existsSync(manifestPath)) {
  throw new Error(`Service worker manifest not found: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const assetPaths = Object.keys(manifest.hashTable ?? {});
const missingAssets = assetPaths.filter(assetPath => !existsSync(resolve(outputDirectory, `.${assetPath}`)));

if (missingAssets.length > 0) {
  throw new Error(
    `Service worker manifest references ${missingAssets.length} missing asset(s):\n${missingAssets.join('\n')}`,
  );
}

const mapboxLicenseSourcePath = resolve('node_modules/mapbox-gl/LICENSE.txt');
const mapboxLicenseOutputPath = resolve(outputDirectory, 'assets/mapbox-gl/LICENSE.txt');
if (!existsSync(mapboxLicenseSourcePath) || !existsSync(mapboxLicenseOutputPath)) {
  throw new Error('The Mapbox SDK license notice is missing from the source package or browser output.');
}
if (readFileSync(mapboxLicenseSourcePath).compare(readFileSync(mapboxLicenseOutputPath)) !== 0) {
  throw new Error('The browser output does not contain the exact Mapbox SDK license notice.');
}

console.log(`Verified ${assetPaths.length} service worker assets in ${outputDirectory}.`);
