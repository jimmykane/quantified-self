import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { getSportsLibVersion } from './get-sports-lib-version';

const nodeRequire = createRequire(__filename);
const mainPath = nodeRequire.resolve('@sports-alliance/sports-lib');
const packageJsonPath = path.resolve(path.dirname(mainPath), '..', '..', 'package.json');

const loadPackageJson = () => JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };

export const SPORTS_LIB_VERSION = getSportsLibVersion(loadPackageJson);
