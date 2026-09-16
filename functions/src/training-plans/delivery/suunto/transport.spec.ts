import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import type { DeliveryCheckpoint, DeliveryOperation } from '../contracts';
import { SuuntoGuideTransport } from './transport';
import { SuuntoGuideHttpError } from './http';
import { SuuntoHttpFixture } from '../test-support/suunto-http-fixture';
import { packageGuide, readGuideArchive } from './archive';
import { guideExternalId, guideMapping } from './mapping';

describe('Suunto Guide lifecycle — synthetic transport', () => {
  const now = Date.parse('2026-12-29T12:00:00Z'); const owner = 'Quantified Self';
  let server: SuuntoHttpFixture; let transport: SuuntoGuideTransport; let op: DeliveryOperation;
  const guard = vi.fn(async () => {}); let checkpoint: DeliveryCheckpoint;
  const execute = () => transport.execute(op, checkpoint, guard);
  const recover = () => transport.recover(op, checkpoint, guard);
  const next = (patch: Partial<ScheduledWorkoutV1> = {}) => {
    op = { ...op, id: `${op.id}-next`, generation: op.generation + 1, progress: null, workout: { ...op.workout!, ...patch } };
    op.digest = transport.assess(op.workout!, op.destinationKey, op.timeZone).digest;
  };
  beforeEach(() => {
    guard.mockReset(); guard.mockResolvedValue(undefined);
    checkpoint = vi.fn(async () => {}); server = new SuuntoHttpFixture(); transport = new SuuntoGuideTransport(server.request, owner, () => now);
    const workout: ScheduledWorkoutV1 = { schemaVersion: 1, id: 'workout', planId: 'plan', title: 'Intervals', localDate: '2026-12-30',
      lifecycle: 'planned', revision: 1, createdAtMs: now, updatedAtMs: now, structure: { version: 1, sport: ActivityTypes.Running,
        nodes: [{ kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 60 }, targets: [] }] } };
    op = { id: 'attempt', kind: 'upsert', deliveryId: 'stable', generation: 1, connectionGeneration: 'generation', destinationKey: 'destination',
      timeZone: 'Europe/Helsinki', workout, artifact: null, progress: null, contentDigest: 'content', digest: transport.assess(workout, 'destination', 'Europe/Helsinki').digest };
  });
  it('creates, updates and reschedules the same Guide, preserves pinning and withdraws', async () => {
    const original = (await execute())!; server.guides.get(original.ids.guide)!.pinned = true;
    next({ title: 'Changed', localDate: '2027-01-02', planId: 'other-plan' });
    const changed = (await execute())!;
    expect(changed.ids).toEqual(original.ids); expect(server.guides.get(changed.ids.guide)!.pinned).toBe(true);
    expect(server.guides.get(changed.ids.guide)!.guide.localDate).toBe('2027-01-02');
    op = { ...op, kind: 'remove', workout: null, progress: null };
    expect(await execute()).toBeNull(); expect(server.guides.size).toBe(0);
  });
  it('updates a retained pre-normalization Guide in place without changing pinning or identity', async () => {
    next({ title: 'Sample — interval session' });
    const artifact = (await execute())!;
    const retained = server.guides.get(artifact.ids.guide)!;
    retained.guide.name = op.workout!.title;
    retained.guide.shortDescription = Array.from(op.workout!.title).slice(0, 23).join('');
    retained.pinned = true;
    next();
    expect((await execute())!.ids).toEqual(artifact.ids);
    expect(server.guides.get(artifact.ids.guide)!.guide.name).toBe('Sample - interval session');
    expect(server.guides.get(artifact.ids.guide)!.pinned).toBe(true);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(request => request.method === 'PUT')).toHaveLength(1);
  });
  it('does not duplicate an uncertain pre-normalization create whose content no longer matches', async () => {
    next({ title: 'Sample — interval session' });
    const artifact = (await execute())!;
    const retained = server.guides.get(artifact.ids.guide)!;
    retained.guide.name = op.workout!.title;
    retained.guide.shortDescription = Array.from(op.workout!.title).slice(0, 23).join('');
    op = { ...op, artifact: null, progress: { version: 1, step: 'create', state: 'started' } };
    expect(await recover()).toEqual({ kind: 'uncertain' });
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(1);
    expect(server.guides.size).toBe(1);
  });
  it('packages deterministic ZIPs with a valid non-personal 300x300 icon', async () => {
    const guide = guideMapping(op.workout!, op.destinationKey, owner).artifact;
    const archive = await packageGuide(guide); expect(await packageGuide(guide)).toEqual(archive);
    const zip = await JSZip.loadAsync(archive); expect(Object.keys(zip.files).sort()).toEqual(['guide.json', 'icon.png']);
    const icon = await zip.file('icon.png')!.async('nodebuffer'); expect(icon.subarray(1, 4).toString()).toBe('PNG');
    expect([icon.readUInt32BE(16), icon.readUInt32BE(20)]).toEqual([300, 300]);
    expect(await readGuideArchive(archive)).toEqual(guide);
  });
  it('bounds decompression and rejects malformed archives', async () => {
    const zip = new JSZip(); zip.file('guide.json', 'x'.repeat(300_000));
    await expect(readGuideArchive(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))).rejects.toThrow();
    await expect(readGuideArchive(Buffer.from('not-zip'))).rejects.toThrow();
  });
  it('isolates external IDs between accounts/users and copied workouts', () => {
    expect(guideExternalId('a', 'w')).not.toBe(guideExternalId('b', 'w'));
    expect(guideExternalId('a', 'w')).not.toBe(guideExternalId('a', 'copy'));
    expect(guideExternalId('a', 'w').length).toBeLessThanOrEqual(64);
  });
  it('recovers accepted create after a lost response without another POST', async () => {
    server.afterHandle = async req => { if (req.method === 'POST') { server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false); } };
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(op.progress).toMatchObject({ step: 'create', state: 'started' });
    expect(await recover()).toMatchObject({ kind: 'accepted' });
    expect(server.calls.filter(req => req.method === 'POST')).toHaveLength(1);
  });
  it('recovers accepted create after checkpoint persistence fails', async () => {
    checkpoint = async (_artifact, progress) => { if (progress?.state === 'accepted') throw new Error('persistence'); };
    await expect(execute()).rejects.toThrow('persistence'); checkpoint = vi.fn();
    expect(await recover()).toMatchObject({ kind: 'accepted' }); expect(server.guides.size).toBe(1);
  });
  it('accepts a conflict only after exact owned content is found', async () => {
    const original = (await execute())!; op = { ...op, artifact: null, progress: null };
    expect((await execute())!.ids).toEqual(original.ids);
    op = { ...op, artifact: null, progress: null }; next({ title: 'Different content' });
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(await recover()).toEqual({ kind: 'uncertain' });
  });
  it('never repeats an uncertain create from empty inventory, including explicit recovery', async () => {
    op.progress = { version: 1, step: 'create', state: 'started' };
    expect(await recover()).toEqual({ kind: 'uncertain' }); expect(await recover()).toEqual({ kind: 'uncertain' });
    await expect(execute()).rejects.toMatchObject({ kind: 'uncertain' });
    expect(server.calls.every(req => req.method === 'GET')).toBe(true);
  });
  it('resumes discovery across bounded pages without authorizing another create', async () => {
    const guide = guideMapping(op.workout!, op.destinationKey, owner).artifact;
    for (let i = 0; i < 155; i++) server.guides.set(`unrelated-${i}`, { guide: { ...guide, externalId: `unrelated-${i}` }, pinned: false });
    server.guides.set('recovered', { guide, pinned: false });
    op.progress = { version: 1, step: 'create', state: 'started' };
    await expect(recover()).rejects.toMatchObject({ kind: 'retryable' });
    expect(op.progress?.step).toBe('discover-150'); expect(await recover()).toMatchObject({ kind: 'accepted', artifact: { ids: { guide: 'recovered' } } });
  });
  it('rejects duplicate external identities', async () => {
    const guide = guideMapping(op.workout!, op.destinationKey, owner).artifact;
    server.guides.set('a', { guide, pinned: false }); server.guides.set('b', { guide, pinned: false });
    op.progress = { version: 1, step: 'create', state: 'started' };
    expect(await recover()).toEqual({ kind: 'uncertain' });
  });
  it('traverses unrelated undated Guides during exact create recovery', async () => {
    await execute(); op.progress = { version: 1, step: 'create', state: 'started' }; op.artifact = null;
    const client = server.request;
    transport = new SuuntoGuideTransport(async (request, beforeSend) => {
      const response = await client(request, beforeSend);
      if (request.path.startsWith('/v2/guides/items?')) (response.body as unknown[]).unshift({ id: 'unrelated', owner,
        username: 'fixture-account', pinned: false, localDate: null, externalId: null });
      return response;
    }, owner, () => now);
    expect(await recover()).toMatchObject({ kind: 'accepted' });
  });
  it('recovers a lost PUT acknowledgement without replacing the Guide', async () => {
    await execute(); next({ title: 'Edited' });
    server.afterHandle = async req => { if (req.method === 'PUT') { server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false); } };
    await expect(execute()).rejects.toThrow(); expect(await recover()).toMatchObject({ kind: 'accepted' });
    expect(server.calls.filter(req => req.method === 'POST')).toHaveLength(1);
  });
  it('does not claim a lost DELETE completed from an ambiguous 404', async () => {
    await execute(); op = { ...op, kind: 'remove', workout: null, progress: null };
    server.afterHandle = async req => { if (req.method === 'DELETE') { server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false); } };
    await expect(execute()).rejects.toThrow(); expect(await recover()).toEqual({ kind: 'uncertain' });
  });
  it.each(['2026-12-28', '2027-01-05'])('does not send outside the saved-zone window: %s', async localDate => {
    next({ localDate }); await expect(execute()).rejects.toThrow(); expect(server.calls).toHaveLength(0);
  });
  it('uses saved-zone calendar days across DST rather than elapsed 24-hour periods', async () => {
    // Helsinki is already October 25; DST ends during this local day.
    transport = new SuuntoGuideTransport(server.request, owner, () => Date.parse('2026-10-24T22:30:00Z'));
    next({ localDate: '2026-10-31' }); expect(await execute()).toMatchObject({ localDate: '2026-10-31' });
    next({ localDate: '2026-11-01' }); const count = server.calls.length;
    await expect(execute()).rejects.toThrow(); expect(server.calls).toHaveLength(count);
  });
  it('honors final guards and known completed protection', async () => {
    guard.mockRejectedValueOnce(new Error('stop')); await expect(execute()).rejects.toThrow('stop'); expect(server.calls).toHaveLength(0);
    op.progress = null; await execute(); op.artifact!.completed = true; next();
    const count = server.calls.length; await expect(execute()).rejects.toThrow(); expect(server.calls).toHaveLength(count);
  });
  it('checks cloud presence independently of pinning and refuses to infer absence', async () => {
    const artifact = (await execute())!;
    const request = { destinationKey: op.destinationKey, connectionGeneration: op.connectionGeneration, artifact, timeZone: op.timeZone, cursor: null };
    expect(await transport.inspection.inspect(request, guard)).toMatchObject({ artifacts: [{ key: 'guide', state: 'present' }] });
    server.guides.get(artifact.ids.guide)!.pinned = false;
    expect(await transport.inspection.inspect(request, guard)).toMatchObject({ artifacts: [{ state: 'present' }] });
    server.guides.delete(artifact.ids.guide);
    expect(await transport.inspection.inspect(request, guard)).toMatchObject({ artifacts: [{ state: 'unknown', authoritative: false }] });
    expect(transport.inspection.policy.repairReady).toBe(false);
  });
  it('does not overwrite or withdraw an externally moved Guide', async () => {
    const artifact = (await execute())!; server.guides.get(artifact.ids.guide)!.guide.localDate = '2026-12-31'; next({ title: 'Edit' });
    await expect(execute()).rejects.toThrow(); op = { ...op, kind: 'remove', workout: null, progress: null }; await expect(execute()).rejects.toThrow();
    expect(server.calls.filter(req => ['PUT', 'DELETE'].includes(req.method))).toHaveLength(0);
  });
});
