import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildConnectionHistoryMonitoring, OWNER } from './definitions.mjs';
import { applyOwnedMonitoring } from '../monitoring/apply.mjs';
import { runMonitoringCli } from '../monitoring/cli.mjs';

export const applyConnectionHistoryMonitoring = (bundle, request) => applyOwnedMonitoring(bundle, request, OWNER);
export const main = args => runMonitoringCli(args, buildConnectionHistoryMonitoring, applyConnectionHistoryMonitoring);
function invokedDirectly() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (invokedDirectly()) main(process.argv.slice(2)).catch(() => {
  console.error('Connection history monitoring setup failed. Check explicit arguments and authenticated console; no private response is printed.');
  process.exitCode = 1;
});
