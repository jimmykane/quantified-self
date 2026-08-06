import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ALLOWED_CREDENTIAL_TEMPLATE_PATHS = new Set([
  'functions/.secret.local.example',
]);

const FORBIDDEN_CREDENTIAL_PATH_PATTERNS = [
  /(?:^|\/)\.env(?:\.[^/]*)?$/i,
  /(?:^|\/)\.secret(?:\.[^/]*)?$/i,
  /(?:^|\/)\.runtimeconfig\.json$/i,
  /(?:^|\/)[^/]*(?:service[-_]?account|firebase-adminsdk)[^/]*\.json$/i,
  /(?:^|\/)[^/]*\.(?:key|p12|pfx)$/i,
];

const FORBIDDEN_LOCAL_CONFIGURATION_PATHS = new Set([
  'src/environments/mapbox-token.local.ts',
]);

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function findForbiddenCredentialPaths(paths) {
  return [...new Set(paths.map(normalizePath).filter((path) => (
    !ALLOWED_CREDENTIAL_TEMPLATE_PATHS.has(path)
    && (
      FORBIDDEN_LOCAL_CONFIGURATION_PATHS.has(path)
      || FORBIDDEN_CREDENTIAL_PATH_PATTERNS.some((pattern) => pattern.test(path))
    )
  )))].sort();
}

function stagedPaths() {
  return execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    { encoding: 'buffer' },
  ).toString('utf8').split('\0').filter(Boolean);
}

function main() {
  const forbiddenPaths = findForbiddenCredentialPaths(stagedPaths());
  if (forbiddenPaths.length === 0) return;

  console.error('Refusing to commit credential-like files:');
  for (const path of forbiddenPaths) console.error(`- ${path}`);
  console.error('Keep local values outside Git and use the documented value-free templates.');
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
