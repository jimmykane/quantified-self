import { pathToFileURL } from 'node:url';
import { buildTrainingMonitoring } from './definitions.mjs';
import { applyTrainingMonitoring } from './apply.mjs';
import { runMonitoringCli } from '../monitoring/cli.mjs';
export { parseArguments, decodeMonitoringResponse } from '../monitoring/cli.mjs';
export const main = args => runMonitoringCli(args, buildTrainingMonitoring, applyTrainingMonitoring);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    const safe = /^(Explicit|Select|Unknown|Cloud changes|Confirmation|Unable|Invalid|Selected|One explicit|Malformed|Repeated|Duplicate|Refusing|Unexpected|Dashboard|Immutable|Monitoring API)/;
    console.error(safe.test(error.message) ? error.message : 'Monitoring configuration failed; inspect the authenticated Cloud console.');
    process.exitCode = 1;
  });
}
