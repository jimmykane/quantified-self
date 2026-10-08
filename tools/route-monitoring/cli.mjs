import { pathToFileURL } from 'node:url';
import { buildRouteMonitoring, OWNER } from './definitions.mjs';
import { applyOwnedMonitoring } from '../monitoring/apply.mjs';
import { runMonitoringCli } from '../monitoring/cli.mjs';

export const applyRouteMonitoring = (bundle, request) => applyOwnedMonitoring(bundle, request, OWNER);
export const main = args => runMonitoringCli(args, buildRouteMonitoring, applyRouteMonitoring);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => {
    console.error('Route monitoring setup failed. Check explicit arguments and authenticated console; no private response is printed.');
    process.exitCode = 1;
  });
}
