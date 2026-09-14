import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseCertificationOptions, runCertificationCLI } from './garmin-training-certification';
import { GarminHttpFixture } from '../training-plans/delivery/test-support/garmin-http-fixture';

describe('Garmin certification CLI', () => {
  it('strictly parses explicit targets and rejects credential/remote-ID/URL/fake/execute overrides', () => {
    const args = ['prepare', '--directory=/private-run', '--project=demo-training-delivery', '--uid=fixture',
      '--date=2026-12-31', '--time-zone=Europe/Helsinki', '--sport=running'];
    expect(parseCertificationOptions(args).config?.uid).toBe('fixture');
    for (const extra of ['--url=https://evil.invalid', '--token=secret', '--remote-id=12', '--fake=true', '--execute',
      '--uid=other', '--approve=' + 'a'.repeat(64)]) expect(() => parseCertificationOptions([...args, extra])).toThrow();
    expect(() => parseCertificationOptions(['create', '--directory=/private-run', '--project=other-project'])).toThrow();
    expect(() => parseCertificationOptions(['report', '--directory=relative'])).toThrow();
  });
  it('prepare, report and all action previews remain offline without ADC or runtime construction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'garmin-cli-test-'));
    const runtime = vi.fn(async (): Promise<never> => { throw new Error('Must remain offline'); });
    const write = vi.fn();
    try {
      await runCertificationCLI(['prepare', `--directory=${directory}`, '--project=demo-training-delivery', '--uid=fixture',
        '--date=2026-12-31', '--time-zone=Europe/Helsinki', '--sport=cycling'], write, runtime);
      for (const command of ['create', 'update', 'reschedule', 'inspect', 'remove', 'report']) {
        await runCertificationCLI([command, `--directory=${directory}`], write, runtime);
      }
      expect(runtime).not.toHaveBeenCalled(); expect(write).toHaveBeenCalledTimes(7);
      expect(JSON.stringify(write.mock.calls)).not.toContain('demo-training-delivery');
    } finally { await rm(directory, { recursive: true }); }
  });
  it('refuses to combine emulator authority with real Garmin HTTP', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'garmin-cli-test-'));
    try {
      await runCertificationCLI(['prepare', `--directory=${directory}`, '--project=demo-training-delivery', '--uid=fixture',
        '--date=2026-12-31', '--time-zone=Europe/Helsinki', '--sport=running'], () => undefined);
      vi.stubEnv('FIRESTORE_EMULATOR_HOST', 'localhost:8081');
      await expect(runCertificationCLI(['preflight', `--directory=${directory}`], () => undefined)).rejects.toThrow('Live environment required');
    } finally { vi.unstubAllEnvs(); await rm(directory, { recursive: true }); }
  });
  it('runs the approved lifecycle through reopened real journals, without losing either artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'garmin-cli-test-'));
    const server = new GarminHttpFixture(); let now = Date.parse('2026-12-20T10:00:00Z');
    const runtime = async () => ({ authority: async () => ({ binding: { destinationKey: 'a'.repeat(64), generation: 'g1', epoch: 0 },
      accessToken: 'synthetic-only', pro: true }), client: server.request, now: () => now, sleep: async (ms: number) => { now += ms; }, close: async () => undefined });
    const output = vi.fn();
    try {
      await runCertificationCLI(['prepare', `--directory=${directory}`, '--project=demo-training-delivery', '--uid=fixture',
        '--date=2026-12-31', '--time-zone=Europe/Helsinki', '--sport=cycling'], output, runtime);
      for (const command of ['preflight', 'create', 'inspect', 'update', 'inspect', 'reschedule', 'inspect', 'remove', 'inspect']) {
        await runCertificationCLI([command, `--directory=${directory}`], output, runtime);
        const digest = (output.mock.lastCall![0] as { approval: string }).approval;
        await runCertificationCLI([command, `--directory=${directory}`, `--approve=${digest}`], output, runtime);
      }
      expect(server.workouts.size + server.schedules.size).toBe(0);
      expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(2);
      expect(output.mock.lastCall![0]).toMatchObject({ phase: 'removed', failure: null,
        observations: [{ passed: true }, { passed: true }, { passed: true }, { passed: true }] });
    } finally { await rm(directory, { recursive: true }); }
  });
});
