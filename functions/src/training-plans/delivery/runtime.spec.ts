import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { PLANNED_WORKOUT_PROVIDER_IDS } from '../../../../shared/planned-workout-providers';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { productionDeliveryRuntime } from './runtime';
import { authorizeSuuntoGuideRequest } from './suunto/authorization';
import { readGuideArchive } from './suunto/archive';
import { guideExternalId } from './suunto/mapping';
import type { DeliveryOperation } from './contracts';
import type { InspectionRequest } from './verification-contracts';

vi.mock('./suunto/authorization', () => ({ authorizeSuuntoGuideRequest: vi.fn() }));

describe('Production Training delivery rollout', () => {
  const runtime = productionDeliveryRuntime({} as Firestore);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });
  const inspection: InspectionRequest = {
    destinationKey: 'fixture-destination', connectionGeneration: 'fixture-generation',
    artifact: { ids: { guide: 'fixture-guide', externalId: 'fixture-external', owner: 'Quantified Self' },
      localDate: '2026-09-17', completed: false },
    timeZone: 'Europe/Helsinki', cursor: null,
  };

  it.each([undefined, 'unused-legacy-key'])('uses the existing API key and user OAuth token regardless of legacy Guides configuration: %s', async legacyKey => {
    vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', 'Quantified Self');
    vi.stubEnv('SUUNTOAPP_SUBSCRIPTION_KEY', 'fixture-existing-api-key');
    vi.stubEnv('SUUNTOAPP_GUIDES_SUBSCRIPTION_KEY', legacyKey);
    vi.mocked(authorizeSuuntoGuideRequest).mockResolvedValue({ accessToken: 'fixture-user-token', account: 'fixture-account' });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: null, payload: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const guard = vi.fn(async () => {});
    const transport = runtime.transport('suunto', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2')!;

    expect(await transport.inspection!.inspect(inspection, guard)).toMatchObject({
      artifacts: [{ key: 'guide', state: 'unknown', authoritative: false }],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const path of ['/v2/guides/files/fixture-guide', '/v2/guides/items?offset=0&limit=50']) {
      expect(fetcher).toHaveBeenCalledWith(`https://cloudapi.suunto.com${path}`, expect.objectContaining({
        redirect: 'error', headers: expect.objectContaining({
          Authorization: 'Bearer fixture-user-token', 'Ocp-Apim-Subscription-Key': 'fixture-existing-api-key',
        }),
      }));
    }
    expect(authorizeSuuntoGuideRequest).toHaveBeenCalledWith(runtime.db, 'xcsAolLDDTWTgtRN9eYF3lW2YKL2', inspection);
    expect(guard).toHaveBeenCalled();
  });

  it.each([undefined, ''])('fails closed before OAuth or HTTP when the existing subscription key is missing: %s', async key => {
    vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', 'Quantified Self');
    vi.stubEnv('SUUNTOAPP_SUBSCRIPTION_KEY', key);
    vi.stubEnv('SUUNTOAPP_GUIDES_SUBSCRIPTION_KEY', 'unused-legacy-key');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const transport = runtime.transport('suunto', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2')!;
    await expect(transport.inspection!.inspect(inspection, vi.fn(async () => {})))
      .rejects.toMatchObject({ kind: 'terminal', rejected: true });
    expect(authorizeSuuntoGuideRequest).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('binds Suunto with the configured application name without reading API credentials or making requests', () => {
    vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', 'Fixture application');
    for (const key of ['SUUNTOAPP_CLIENT_ID', 'SUUNTOAPP_CLIENT_SECRET', 'SUUNTOAPP_SUBSCRIPTION_KEY']) vi.stubEnv(key, undefined);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const transport = runtime.transport('suunto', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2');
    expect(transport).toMatchObject({ horizonDays: 6, withdrawOutsideHorizon: true });
    expect(transport?.inspection?.policy).toMatchObject({ mode: 'unavailable', authoritativeAbsenceKeys: [], repairReadyKeys: [] });
    expect(runtime.transport('suunto', 'other')).toBeNull();
    expect(authorizeSuuntoGuideRequest).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([undefined, '', ' Application ', 'Application\n', 'x'.repeat(65)])('keeps Suunto unavailable for a missing/invalid owner without blocking Garmin: %s', owner => {
    vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', owner);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(runtime.transport('suunto', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2')).toBeNull();
    expect(runtime.transport('garmin', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2')?.mappingVersion).toBeTruthy();
    expect(authorizeSuuntoGuideRequest).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['Quantified Self', 'Fixture application'])('uses configured owner %s in Guide JSON and acceptance evidence', async owner => {
    vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', owner);
    vi.stubEnv('SUUNTOAPP_SUBSCRIPTION_KEY', 'fixture-existing-api-key');
    vi.mocked(authorizeSuuntoGuideRequest).mockResolvedValue({ accessToken: 'fixture-user-token', account: 'fixture-account' });
    const now = Date.parse('2026-09-16T12:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const workout: ScheduledWorkoutV1 = {
      schemaVersion: 1, id: 'fixture-workout', planId: null, title: 'Easy run', localDate: '2026-09-17',
      lifecycle: 'planned', revision: 1, createdAtMs: now, updatedAtMs: now,
      structure: { version: 1, sport: ActivityTypes.Running, nodes: [
        { kind: 'step', id: 'run', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] },
      ] },
    };
    const externalId = guideExternalId(inspection.destinationKey, workout.id);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: null, payload: {
      id: 'fixture-guide', username: 'fixture-account', owner,
      externalId, localDate: workout.localDate, pinned: false,
    } }), { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    const transport = runtime.transport('suunto', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2')!;
    const assessment = transport.assess(workout, inspection.destinationKey, inspection.timeZone);
    expect(assessment.level).toBe('exact');
    const operation: DeliveryOperation = {
      id: 'fixture-attempt', kind: 'upsert', deliveryId: 'fixture-delivery', generation: 1,
      destinationKey: inspection.destinationKey, connectionGeneration: inspection.connectionGeneration,
      timeZone: inspection.timeZone, workout, artifact: null, progress: null,
      contentDigest: 'fixture-content', digest: assessment.digest,
    };
    const checkpoint = vi.fn(async () => {});
    const artifact = await transport.execute(operation, checkpoint, vi.fn(async () => {}));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://cloudapi.suunto.com/v2/guides/files', expect.objectContaining({ method: 'POST' }));
    const body = fetcher.mock.calls[0][1].body;
    expect(body).toBeInstanceOf(Uint8Array);
    expect(await readGuideArchive(Buffer.from(body))).toMatchObject({ owner, externalId });
    expect(artifact?.ids).toEqual({ guide: 'fixture-guide', owner, externalId });
    expect(checkpoint).toHaveBeenLastCalledWith(artifact, { version: 1, step: 'finished', state: 'accepted' });
  });

  it('constructs only implemented adapters for the pilot UID', () => {
    vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', 'Fixture application');
    for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) {
      const transport = runtime.transport(provider, 'xcsAolLDDTWTgtRN9eYF3lW2YKL2');
      expect(transport?.mappingVersion).toBeTruthy();
    }
  });

  it('binds COROS only to the batch path and keeps remote checking unavailable', () => {
    const transport = runtime.transport('coros', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2');
    expect(transport).toMatchObject({ horizonDays: 365, batch: { maxSize: 30 } });
    expect(transport?.inspection).toBeUndefined();
    expect(runtime.transport('coros', 'other')).toBeNull();
  });
  it('binds Wahoo with the seven-day horizon and independent positive-only inspection', () => {
    const transport = runtime.transport('wahoo', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2');
    expect(transport).toMatchObject({ horizonDays: 6, withdrawOutsideHorizon: true });
    expect(transport?.inspection?.policy).toMatchObject({ required: ['plan', 'workout', 'association'], authoritativeAbsenceKeys: [], repairReadyKeys: [] });
    expect(runtime.transport('wahoo', 'other')).toBeNull();
  });

  it.each(['', 'another-user', ' xcsAolLDDTWTgtRN9eYF3lW2YKL2', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2 '])(
    'never binds a transport for non-pilot identity %s', uid => {
      vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', 'Fixture application');
      for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) expect(runtime.transport(provider, uid)).toBeNull();
    });
});
