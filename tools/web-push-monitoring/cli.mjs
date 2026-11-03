import { pathToFileURL } from 'node:url';
import { runMonitoringCli } from '../monitoring/cli.mjs';
import { applyOwnedMonitoring } from '../monitoring/apply.mjs';
import { buildWebPushMonitoring, OWNER } from './definitions.mjs';
export const applyWebPushMonitoring = (bundle, request) => applyOwnedMonitoring(bundle, request, OWNER);
export const main = args => runMonitoringCli(args, buildWebPushMonitoring, applyWebPushMonitoring);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => { console.error('Web Push monitoring setup failed; no private response is printed.'); process.exitCode = 1; });
}
