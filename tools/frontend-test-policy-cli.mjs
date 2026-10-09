import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkPolicy, reasonsFile } from './frontend-test-policy.mjs';
import { discoverSpecs } from './frontend-test-shards.mjs';

const root = process.cwd();
function git(args) {
  const output = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return args.includes('-z') ? output : output.trim();
}

try {
  const args = process.argv.slice(2);
  assert(args.length === 0 || args.length === 2 && args[0] === '--base', 'Usage: npm run test:frontend-policy -- [--base <revision>]');
  const requested = args[1] ?? process.env.QS_FRONTEND_TEST_POLICY_BASE ?? 'origin/develop';
  const ref = /^0+$/.test(requested) ? 'origin/develop' : requested;
  assert(ref && !ref.startsWith('-') && !ref.includes('\0'), 'Invalid comparison revision');
  let base;
  try {
    const commit = git(['rev-parse', '--verify', `${ref}^{commit}`]);
    base = git(['merge-base', 'HEAD', commit]);
  } catch {
    throw new Error(`Cannot compare frontend tests with ${ref}. Fetch the base/history and rerun with --base <revision>; comparison must not be skipped.`);
  }
  const baseFiles = git(['ls-tree', '-r', '-z', '--name-only', base]).split('\0');
  const registryFile = 'tools/frontend-test-environments.json';
  const baseRegistry = baseFiles.includes(registryFile)
    ? JSON.parse(git(['show', `${base}:${registryFile}`])) : { node: [], dom: [] };
  const specs = await discoverSpecs(root);
  const result = await checkPolicy({ root, specs, baseFiles, baseRegistry,
    reasons: JSON.parse(readFileSync(resolve(root, reasonsFile), 'utf8')),
    changedFiles: git(['diff', '--name-only', '-z', base, '--']).split('\0') });
  for (const message of result.warnings) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      const escaped = message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
      console.log(`::warning::Review fixture setup: ${escaped}`);
    } else console.warn(`Review fixture setup: ${message}`);
  }
  for (const message of result.errors) console.error(message);
  assert.equal(result.errors.length, 0, `${result.errors.length} frontend test policy violation(s)`);
  console.log(`Frontend test policy passed: ${specs.length} specs; comparison ${base}; ${result.warnings.length} fixture review warning(s).`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
