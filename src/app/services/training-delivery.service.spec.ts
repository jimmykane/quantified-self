import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { Firestore } from 'app/firebase/firestore';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { TrainingDeliveryService } from './training-delivery.service';

describe('TrainingDeliveryService boundary', () => {
  it('keeps every production provider unavailable and sends only the focused command payload', async () => {
    const call = vi.fn(async (_name: string, _payload: unknown) => ({ data: { schemaVersion: 1 } }));
    TestBed.configureTestingModule({ providers: [TrainingDeliveryService,
      { provide: Firestore, useValue: {} }, { provide: AppFunctionsService, useValue: { call } },
      { provide: BrowserCompatibilityService, useValue: { createRandomUUID: () => 'mutation-id' } },
    ] });
    const service = TestBed.inject(TrainingDeliveryService);
    expect(service.anyReady).toBe(false);
    for (const provider of ['garmin', 'coros', 'wahoo', 'suunto'] as const) expect(service.isReady(provider)).toBe(false);
    const command = { schemaVersion: 1 as const, scope: 'workout' as const, scopeId: 'workout', provider: 'garmin' as const,
      mutationId: service.createMutationId(), action: 'stop' as const, expectedScheduleRevision: 1, expectedScopeRevision: 1, expectedSettingsRevision: 0 };
    await service.preview(command); await service.mutate(command);
    expect(call.mock.calls.map(args => args[0])).toEqual(['previewTrainingProviderDelivery', 'mutateTrainingProviderDelivery']);
    expect(call).toHaveBeenLastCalledWith('mutateTrainingProviderDelivery', command);
    expect(await firstValueFrom(service.watchPresence('', 'workout', 'id'))).toBe(false);
  });
});
