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

console.log(`Verified ${assetPaths.length} service worker assets in ${outputDirectory}.`);
