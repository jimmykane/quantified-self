import { getSportsLibVersion } from '@shared/get-sports-lib-version';

declare function require(moduleName: string): any;

const loadPackageJson = () => require('../../../node_modules/@sports-alliance/sports-lib/package.json') as { version: string };

export const SPORTS_LIB_VERSION = getSportsLibVersion(loadPackageJson);
