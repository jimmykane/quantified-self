import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Firestore } from 'app/firebase/firestore';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { TrainingDeliveryService } from './training-delivery.service';
import { AppUserService } from './app.user.service';

describe('TrainingDeliveryService boundary', () => {
  it('reacts to pilot sign-in, account changes and sign-out without sending consent or delivery work', async () => {
    const call = vi.fn(async (_name: string, _payload: unknown) => ({ data: { schemaVersion: 1 } }));
    const user = signal<{ uid: string } | null>(null);
    TestBed.configureTestingModule({ providers: [TrainingDeliveryService,
      { provide: Firestore, useValue: {} }, { provide: AppFunctionsService, useValue: { call } },
      { provide: BrowserCompatibilityService, useValue: { createRandomUUID: () => 'mutation-id' } },
      { provide: AppUserService, useValue: { user } },
    ] });
    const service = TestBed.inject(TrainingDeliveryService);
    expect(service.anyReady()).toBe(false);
    for (const provider of ['garmin', 'coros', 'wahoo', 'suunto'] as const) expect(service.isReady(provider)).toBe(false);
    user.set({ uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2' });
    expect(service.anyReady()).toBe(true);
    expect(service.isReady('garmin')).toBe(true);
    for (const provider of ['coros', 'wahoo', 'suunto'] as const) expect(service.isReady(provider)).toBe(false);
    user.set({ uid: 'another-user' });
    expect(service.anyReady()).toBe(false);
    expect(service.isReady('garmin')).toBe(false);
    user.set({ uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2' });
    user.set(null);
    expect(service.anyReady()).toBe(false);
    expect(call).not.toHaveBeenCalled();
    const command = { schemaVersion: 1 as const, scope: 'workout' as const, scopeId: 'workout', provider: 'garmin' as const,
      mutationId: service.createMutationId(), action: 'stop' as const, expectedScheduleRevision: 1, expectedScopeRevision: 1, expectedSettingsRevision: 0 };
    await service.preview(command); await service.mutate(command);
    expect(call.mock.calls.map(args => args[0])).toEqual(['previewTrainingProviderDelivery', 'mutateTrainingProviderDelivery']);
    expect(call).toHaveBeenLastCalledWith('mutateTrainingProviderDelivery', command);
    expect(await firstValueFrom(service.watchPresence('', 'workout', 'id'))).toBe(false);
  });
});
