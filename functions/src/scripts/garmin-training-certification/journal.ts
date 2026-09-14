import { constants } from 'node:fs';
import { lstat, open, realpath, readdir, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { initialState, stateSchema, type Config, type RunState } from './model';

export interface Journal { readonly state: RunState; save(next: RunState): Promise<void>; }
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REVISIONS = 1000;
function fail(): never { throw new Error('Private journal unavailable; preserve it for operator inspection.'); }

async function privateDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) fail();
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) fail();
  const canonical = await realpath(path);
  for (let current = canonical; ; current = dirname(current)) {
    try { await lstat(join(current, '.git')); fail(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (dirname(current) === current) break;
  }
  return canonical;
}
async function checkFile(handle: FileHandle): Promise<void> {
  const stat = await handle.stat();
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > MAX_BYTES) fail();
}
function validateTransition(previous: RunState, next: RunState): void {
  if (next.revision !== previous.revision + 1 || next.revision > MAX_REVISIONS || next.runId !== previous.runId
    || JSON.stringify(next.config) !== JSON.stringify(previous.config) || next.requestCount < previous.requestCount) fail();
}

/** Exclusive LOCAL lock, never time-expired. A crashed process needs deliberate operator
 * inspection before its lock is removed; a second machine must never share this run. */
export async function withJournal<T>(directory: string, config: Config | null, use: (journal: Journal) => Promise<T>): Promise<T> {
  const path = await privateDirectory(directory);
  const lockPath = join(path, 'run.lock');
  const lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  let handle: FileHandle | undefined;
  let directoryHandle: FileHandle | undefined;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid })); await lock.sync();
    directoryHandle = await open(path, constants.O_RDONLY); await directoryHandle.sync();
    const journalPath = join(path, 'journal.jsonl');
    if (config) {
      if ((await readdir(path)).some(name => name !== 'run.lock')) fail();
      handle = await open(journalPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(`${JSON.stringify(initialState(config))}\n`); await handle.sync(); await directoryHandle.sync();
      await handle.close(); handle = undefined;
    }
    handle = await open(journalPath, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW);
    await checkFile(handle);
    const raw = await handle.readFile('utf8');
    // Do not truncate a torn append or fall back to older evidence after an uncertain POST.
    if (!raw.endsWith('\n')) fail();
    const lines = raw.slice(0, -1).split('\n');
    if (!lines.length || lines.length > MAX_REVISIONS + 1) fail();
    let state = stateSchema.parse(JSON.parse(lines[0]));
    if (state.revision !== 0 || state.phase !== 'prepared' || state.binding || state.pending || state.artifact || state.retained
      || state.requestCount || state.observations.length) fail();
    for (const line of lines.slice(1)) {
      const next = stateSchema.parse(JSON.parse(line)); validateTransition(state, next); state = next;
    }
    let poisoned = false;
    return await use({ get state() { return structuredClone(state); }, async save(value) {
      if (poisoned) fail();
      const next = stateSchema.parse(value); validateTransition(state, next);
      const encoded = `${JSON.stringify(next)}\n`;
      try {
        await checkFile(handle!);
        if ((await handle!.stat()).size + Buffer.byteLength(encoded) > MAX_BYTES) fail();
        await handle!.writeFile(encoded); await handle!.sync(); state = next;
      } catch (error) { poisoned = true; throw error; }
    } });
  } finally {
    await handle?.close(); await directoryHandle?.close(); await lock.close(); await unlink(lockPath);
  }
}
