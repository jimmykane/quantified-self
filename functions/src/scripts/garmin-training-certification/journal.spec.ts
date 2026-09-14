import { mkdtemp, chmod, readFile, stat, appendFile, symlink, mkdir, rm, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withJournal } from './journal';

const config = { project: 'demo-training-delivery', uid: 'fixture', date: '2026-12-31', timeZone: 'Europe/Helsinki', sport: 'cycling' as const };
const directories: string[] = [];
async function temporary() { const path = await mkdtemp(join(tmpdir(), 'garmin-cert-test-')); directories.push(path); return path; }
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true }); });
describe('private append-only certification journal', () => {
  it('persists private full checkpoints and reopens without losing accepted Long IDs', async () => {
    const path = await temporary();
    await withJournal(path, config, async journal => {
      await journal.save({ ...journal.state, revision: 1, phase: 'created', artifact: {
        ids: { workout: '9223372036854775000' }, localDate: config.date, completed: false } });
    });
    await withJournal(path, null, async journal => { expect(journal.state.artifact?.ids.workout).toBe('9223372036854775000'); });
    expect((await stat(join(path, 'journal.jsonl'))).mode & 0o777).toBe(0o600);
    expect((await readFile(join(path, 'journal.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(2);
  });
  it('refuses simultaneous operators and preserves the active lock', async () => {
    const path = await temporary();
    await withJournal(path, config, async () => {
      await expect(withJournal(path, null, async () => undefined)).rejects.toThrow();
      expect(JSON.parse(await readFile(join(path, 'run.lock'), 'utf8')).pid).toBe(process.pid);
    });
  });
  it('fails closed on torn, reordered or malformed evidence', async () => {
    const path = await temporary();
    await withJournal(path, config, async journal => {
      await expect(journal.save({ ...journal.state, revision: 2 })).rejects.toThrow();
    });
    await appendFile(join(path, 'journal.jsonl'), '{"unfinished":');
    await expect(withJournal(path, null, async () => undefined)).rejects.toThrow();
  });
  it('rejects insecure directories/files, symlinks and repository-contained runs', async () => {
    const path = await temporary();
    await chmod(path, 0o755);
    await expect(withJournal(path, config, async () => undefined)).rejects.toThrow();
    await chmod(path, 0o700);
    await withJournal(path, config, async () => undefined);
    await chmod(join(path, 'journal.jsonl'), 0o644);
    await expect(withJournal(path, null, async () => undefined)).rejects.toThrow();
    const outer = await temporary();
    await symlink(path, join(outer, 'alias'));
    await expect(withJournal(join(outer, 'alias'), null, async () => undefined)).rejects.toThrow();
    await writeFile(join(outer, '.git'), 'gitdir: synthetic');
    await mkdir(join(outer, 'run'), { mode: 0o700 });
    await expect(withJournal(join(outer, 'run'), config, async () => undefined)).rejects.toThrow();
  });
  it('never overwrites an existing run during prepare', async () => {
    const path = await temporary();
    await withJournal(path, config, async () => undefined);
    const before = await readFile(join(path, 'journal.jsonl'), 'utf8');
    await expect(withJournal(path, config, async () => undefined)).rejects.toThrow();
    expect(await readFile(join(path, 'journal.jsonl'), 'utf8')).toBe(before);
  });
  it('poisons the current writer after fsync failure instead of continuing from uncertain persistence', async () => {
    const path = await temporary();
    await withJournal(path, config, async journal => {
      const probe = await open(join(path, 'probe'), 'wx', 0o600);
      const sync = vi.spyOn(Object.getPrototypeOf(probe), 'sync').mockRejectedValueOnce(new Error('Synthetic fsync failure'));
      try {
        await expect(journal.save({ ...journal.state, revision: 1, phase: 'created' })).rejects.toThrow();
        expect(journal.state.revision).toBe(0);
        await expect(journal.save({ ...journal.state, revision: 1 })).rejects.toThrow();
        expect(sync).toHaveBeenCalledTimes(1);
      } finally { sync.mockRestore(); await probe.close(); }
    });
  });
});
