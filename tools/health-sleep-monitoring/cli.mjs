import { pathToFileURL } from 'node:url';
import { buildHealthSleepMonitoring, OWNER } from './definitions.mjs';
import { applyOwnedMonitoring } from '../monitoring/apply.mjs';
import { runMonitoringCli } from '../monitoring/cli.mjs';

export const applyHealthSleepMonitoring = (bundle, request) => applyOwnedMonitoring(bundle, request, OWNER);
export const main = args => runMonitoringCli(args, buildHealthSleepMonitoring, applyHealthSleepMonitoring);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => { console.error('Health/Sleep monitoring setup failed. Check explicit arguments and the authenticated console; no private response is printed.'); process.exitCode = 1; });
}
