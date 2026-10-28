import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCleanupMonitoring, OWNER } from './definitions.mjs';
import { applyOwnedMonitoring } from '../monitoring/apply.mjs';
import { runMonitoringCli } from '../monitoring/cli.mjs';

export const applyCleanupMonitoring = (bundle, request) => applyOwnedMonitoring(bundle, request, OWNER);
export const main = args => runMonitoringCli(args, buildCleanupMonitoring, applyCleanupMonitoring);
function invokedDirectly() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (invokedDirectly()) main(process.argv.slice(2)).catch(() => {
  console.error('Cleanup monitoring setup failed. Check explicit arguments and authenticated console; no private response is printed.');
  process.exitCode = 1;
});
