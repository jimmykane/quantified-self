import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildTrainingMonitoring } from './definitions.mjs';
import { applyTrainingMonitoring } from './apply.mjs';

export function parseArguments(args) {
  const options = {};
  for (const arg of args) {
    if (arg === '--apply' && !options.apply) options.apply = true;
    else {
      const match = /^--(project|notification-channel|confirm-project)=(.+)$/.exec(arg);
      if (!match || options[match[1]] !== undefined) throw new Error('Unknown or duplicate argument.');
      options[match[1]] = match[2];
    }
  }
  if (options.apply && (options['confirm-project'] !== options.project || !options['notification-channel'])) {
    throw new Error('Cloud changes require --apply, a matching --confirm-project and an existing email channel.');
  }
  if (!options.apply && options['confirm-project']) throw new Error('Confirmation is only valid with --apply.');
  return options;
}

export async function main(args) {
  const options = parseArguments(args);
  const bundle = buildTrainingMonitoring(options.project, options['notification-channel']);
  if (!options.apply) {
    // No credentials, files, network requests or cloud changes in preview mode.
    console.log(JSON.stringify(bundle, null, 2));
    return;
  }
  let token;
  try { token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new Error('Unable to obtain gcloud credentials.'); }
  if (!token || /\s/.test(token)) throw new Error('Invalid gcloud credential response.');
  const request = async (method, url, body) => {
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000), redirect: 'error' });
    // Never print provider/cloud response bodies or notification-channel labels.
    if (!response.ok) throw new Error(`Monitoring API ${method} failed (HTTP ${response.status}).`);
    return response.json();
  };
  console.log(JSON.stringify(await applyTrainingMonitoring(bundle, request)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    // Network/auth errors can contain private request details; emit only known safe errors.
    const safe = /^(Explicit|Select|Unknown|Cloud changes|Confirmation|Unable|Invalid|Selected|One explicit|Malformed|Repeated|Duplicate|Refusing|Unexpected|Dashboard|Immutable|Monitoring API)/;
    console.error(safe.test(error.message) ? error.message : 'Monitoring configuration failed; inspect the authenticated Cloud console.');
    process.exitCode = 1;
  });
}
