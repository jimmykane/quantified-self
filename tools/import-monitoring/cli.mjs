import { pathToFileURL } from 'node:url';
import { buildImportMonitoring, OWNER } from './definitions.mjs';
import { applyOwnedMonitoring } from '../monitoring/apply.mjs';
import { runMonitoringCli } from '../monitoring/cli.mjs';

export const applyImportMonitoring = (bundle, request) => applyOwnedMonitoring(bundle, request, OWNER);
export const main = args => runMonitoringCli(args, buildImportMonitoring, applyImportMonitoring);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => {
    console.error('Import monitoring configuration failed. Check explicit arguments and the authenticated Cloud console; no private response is printed.');
    process.exitCode = 1;
  });
}
