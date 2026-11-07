import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const numberPattern = /^[1-9][0-9]{0,19}$/;
const readGit = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function readBuildMetadata({ environment = process.env, git = readGit } = {}) {
  const github = environment.GITHUB_ACTIONS === 'true';
  let commit;
  try { commit = git(['rev-parse', '--verify', 'HEAD']); }
  catch {
    if (github) throw new Error('Cannot verify the GitHub build checkout.');
    return { commit: 'unknown', run: 'local', dirty: undefined };
  }
  if (typeof commit !== 'string' || commit.trim() !== commit || !commitPattern.test(commit)) throw new Error('Invalid build commit.');
  if (github && environment.GITHUB_SHA !== commit) throw new Error('GitHub build commit does not match the checkout.');

  let run = 'local';
  if (github) {
    const { GITHUB_RUN_ID: id, GITHUB_RUN_ATTEMPT: attempt } = environment;
    if (![id, attempt].every(value => typeof value === 'string' && value.trim() === value && numberPattern.test(value))) {
      throw new Error('Invalid GitHub build run.');
    }
    run = `${id}.${attempt}`;
  }
  const dirty = git(['status', '--porcelain', '--untracked-files=normal']).length > 0;
  return { commit, run, dirty };
}

export function angularBuildArguments(args, metadata) {
  // Keep identity owned by the checkout, rather than a caller-supplied override.
  if (args.some(arg => /(?:^|=)QS_BUILD_(?:COMMIT|RUN|DIRTY)=/.test(arg))) {
    throw new Error('Build identity cannot be overridden.');
  }
  // Inline each value so Angular's initial project-name parse cannot consume a definition as a positional.
  return ['build', ...args,
    `--define=QS_BUILD_COMMIT=${JSON.stringify(metadata.commit)}`,
    `--define=QS_BUILD_RUN=${JSON.stringify(metadata.run)}`,
    `--define=QS_BUILD_DIRTY=${metadata.dirty === undefined ? 'undefined' : JSON.stringify(metadata.dirty)}`];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = angularBuildArguments(process.argv.slice(2), readBuildMetadata());
    const result = spawnSync(process.execPath, [resolve(root, 'node_modules/@angular/cli/bin/ng.js'), ...args], {
      cwd: root, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
