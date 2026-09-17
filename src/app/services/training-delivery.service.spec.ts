import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Firestore } from 'app/firebase/firestore';
import { AppFunctionsService } from './app.functions.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS, TrainingDeliveryService } from './training-delivery.service';
import { AppUserService } from './app.user.service';

describe('TrainingDeliveryService boundary', () => {
  it('reacts to pilot sign-in, account changes and sign-out without sending consent or delivery work', async () => {
    const call = vi.fn(async (_name: string, _payload: unknown, _options?: { canExecute: () => boolean }) => ({ data: { schemaVersion: 1 } }));
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
    expect(service.isReady('coros')).toBe(true);
    expect(service.isReady('suunto')).toBe(true);
    expect(service.isReady('wahoo')).toBe(false);
    user.set({ uid: 'another-user' });
    expect(service.anyReady()).toBe(false);
    expect(service.isReady('garmin')).toBe(false);
    expect(service.isReady('coros')).toBe(false);
    expect(service.isReady('suunto')).toBe(false);
    user.set({ uid: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2' });
    user.set(null);
    expect(service.anyReady()).toBe(false);
    expect(call).not.toHaveBeenCalled();
    const command = { schemaVersion: 1 as const, scope: 'workout' as const, scopeId: 'workout', provider: 'garmin' as const,
      mutationId: service.createMutationId(), action: 'stop' as const, expectedScheduleRevision: 1, expectedScopeRevision: 1, expectedSettingsRevision: 0 };
    user.set({ uid: 'owner' });
    await service.preview(command); await service.mutate(command);
    expect(call.mock.calls.map(args => args[0])).toEqual(['previewTrainingProviderDelivery', 'mutateTrainingProviderDelivery']);
    expect(call).toHaveBeenLastCalledWith('mutateTrainingProviderDelivery', command, expect.objectContaining({ canExecute: expect.any(Function) }));
    expect(await firstValueFrom(service.watchPresence('', 'workout', 'id'))).toBe(false);
  });
  it('bounds readiness waits and fences late execution after timeout or account/view changes', async () => {
    vi.useFakeTimers();
    try {
      const user = signal<{ uid: string } | null>({ uid: 'owner' });
      const call = vi.fn((_name: string, _payload: unknown, _options?: { canExecute: () => boolean }) => new Promise(() => {}));
      TestBed.configureTestingModule({ providers: [TrainingDeliveryService,
        { provide: Firestore, useValue: {} }, { provide: AppFunctionsService, useValue: { call } },
        { provide: BrowserCompatibilityService, useValue: {} }, { provide: AppUserService, useValue: { user } },
      ] });
      const service = TestBed.inject(TrainingDeliveryService);
      let viewOpen = true;
      const result = service.preview({} as Parameters<typeof service.preview>[0], () => viewOpen);
      const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
      const guard = call.mock.calls[0][2]!.canExecute;
      expect(guard()).toBe(true);
      viewOpen = false; expect(guard()).toBe(false); viewOpen = true;
      user.set({ uid: 'other' }); expect(guard()).toBe(false); user.set({ uid: 'owner' });
      await vi.advanceTimersByTimeAsync(TRAINING_DELIVERY_PREVIEW_TIMEOUT_MS);
      await rejected; expect(guard()).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
