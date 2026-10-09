import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRouteMonitoring, OWNER } from './definitions.mjs';
import { applyOwnedMonitoring } from '../monitoring/apply.mjs';
import { runMonitoringCli } from '../monitoring/cli.mjs';

export const applyRouteMonitoring = (bundle, request) => applyOwnedMonitoring(bundle, request, OWNER);
export const main = args => runMonitoringCli(args, buildRouteMonitoring, applyRouteMonitoring);
function invokedDirectly() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    // Imported from eval/stdin, argv[1] can be an argument rather than a file.
    return false;
  }
}
if (invokedDirectly()) {
  main(process.argv.slice(2)).catch(() => {
    console.error('Route monitoring setup failed. Check explicit arguments and authenticated console; no private response is printed.');
    process.exitCode = 1;
  });
}
