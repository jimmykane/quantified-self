import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, vi } from 'vitest';
import { PLANNED_WORKOUT_PROVIDER_IDS } from '../../../../shared/planned-workout-providers';
import { productionDeliveryRuntime } from './runtime';
import { authorizeSuuntoGuideRequest } from './suunto/authorization';
import type { InspectionRequest } from './verification-contracts';

vi.mock('./suunto/authorization', () => ({ authorizeSuuntoGuideRequest: vi.fn() }));

describe('Production Training delivery rollout', () => {
  const runtime = productionDeliveryRuntime({} as Firestore);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
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
  it('binds Suunto only with the exact owner name, without reading credentials or making requests', () => {
    vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', 'Quantified Self');
    const transport = runtime.transport('suunto', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2');
    expect(transport).toMatchObject({ horizonDays: 6, withdrawOutsideHorizon: true });
    expect(transport?.inspection?.policy).toMatchObject({ authoritativeAbsence: false, repairReady: false });
    expect(runtime.transport('suunto', 'other')).toBeNull();
    vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', '');
    expect(runtime.transport('suunto', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2')).toBeNull();
  });

  it('constructs the real Garmin adapter only for the pilot UID without making requests', () => {
    for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) {
      const transport = runtime.transport(provider, 'xcsAolLDDTWTgtRN9eYF3lW2YKL2');
      if (provider === 'garmin') expect(transport?.mappingVersion).toBeTruthy();
      else expect(transport).toBeNull();
    }
  });

  it.each(['', 'another-user', ' xcsAolLDDTWTgtRN9eYF3lW2YKL2', 'xcsAolLDDTWTgtRN9eYF3lW2YKL2 '])(
    'never binds a transport for non-pilot identity %s', uid => {
      for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) expect(runtime.transport(provider, uid)).toBeNull();
    });
});
