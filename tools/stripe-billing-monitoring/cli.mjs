import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOwnedMonitoring } from '../monitoring/apply.mjs';
import { runMonitoringCli } from '../monitoring/cli.mjs';
import { buildStripeBillingMonitoring, OWNER } from './definitions.mjs';
export const applyStripeBillingMonitoring = (bundle, request) => applyOwnedMonitoring(bundle, request, OWNER);
export const main = args => runMonitoringCli(args, buildStripeBillingMonitoring, applyStripeBillingMonitoring);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(() => {
  console.error('Stripe billing monitoring failed; check explicit target and channel. No private response was printed.'); process.exitCode = 1;
});
