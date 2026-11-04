import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import paths from '../shared/local-secret-paths.js';
import { assertExternalPath, repositoryRoot } from './local-functions.mjs';

export function angularArguments(args, environment = process.env) {
  if (args.includes('--help') || args.includes('-h')) return ['serve', ...args];
  if (args.some(value => /^--ssl-(?:key|cert)(?:=|$)/.test(value))) {
    throw new Error('Select external TLS files with QS_LOCAL_TLS_KEY_FILE and QS_LOCAL_TLS_CERT_FILE.');
  }
  if (args.includes('--ssl=false') || args.some((value, i) => value === '--ssl' && args[i + 1] === 'false')) return ['serve', ...args];
  const local = paths.localSecretPaths(environment);
  for (const file of [local.tlsKey, local.tlsCert]) {
    assertExternalPath(file);
    if (!existsSync(file)) throw new Error('External localhost TLS files are unavailable. Create them or use --ssl=false.');
  }
  return ['serve', ...args, '--ssl-key', local.tlsKey, '--ssl-cert', local.tlsCert];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = angularArguments(process.argv.slice(2));
    const result = spawnSync(process.execPath, [resolve(repositoryRoot, 'node_modules/@angular/cli/bin/ng.js'), ...args], { stdio: 'inherit', cwd: repositoryRoot });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
