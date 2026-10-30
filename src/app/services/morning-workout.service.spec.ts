import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Auth } from 'app/firebase/auth';
import { MorningWorkoutService } from './morning-workout.service';
import { AppUserService } from './app.user.service';
import { AppFunctionsService } from './app.functions.service';
import { AppAnalyticsService } from './app.analytics.service';

describe('MorningWorkoutService owner preferences and existing callable', () => {
  it('defaults off with all data selected, persists only preferences and fences account changes', async () => {
    const auth = { currentUser: { uid: 'owner' } };
    const user = signal<any>({ uid: 'owner', settings: {} });
    const updateUserProperties = vi.fn().mockResolvedValue(undefined), call = vi.fn().mockResolvedValue({ data: { state: 'ready' } });
    const logEvent = vi.fn();
    TestBed.configureTestingModule({ providers: [MorningWorkoutService,
      { provide: Auth, useValue: auth },
      { provide: AppUserService, useValue: { user, updateUserProperties, isProSignal: () => true } },
      { provide: AppFunctionsService, useValue: { call } }, { provide: AppAnalyticsService, useValue: { logEvent } },
    ] });
    const service = TestBed.inject(MorningWorkoutService), preferences = service.preferences();
    expect(preferences.enabled).toBe(false); expect(preferences.controls.timelineContext).toBe(true);
    expect(preferences.controls.hrvContext).toBe(true);
    let acknowledge!: () => void;
    updateUserProperties.mockReturnValueOnce(new Promise<void>(resolve => { acknowledge = resolve; }));
    const write = service.save('owner', { ...preferences, enabled: true }); await Promise.resolve();
    expect(service.saving()).toBe(true); acknowledge(); await write; expect(service.saving()).toBe(false);
    expect(updateUserProperties).toHaveBeenCalledWith(user(), { settings: { appSettings: { morningWorkout: { ...preferences, enabled: true } } } });
    await service.request('owner', 'prepare', () => true);
    expect(call).toHaveBeenCalledWith('generateDayWorkout', { mode: 'morning', action: 'prepare' }, expect.any(Object));
    expect(call.mock.calls[0][2].canExecute()).toBe(true);
    service.event('owner', 'reviewed', 'ready'); expect(logEvent).toHaveBeenCalledWith('morning_workout', { action: 'reviewed', state: 'ready' });
    auth.currentUser = { uid: 'other' }; user.set({ uid: 'other' });
    expect(call.mock.calls[0][2].canExecute()).toBe(false);
    await expect(service.save('owner', preferences)).rejects.toThrow('account changed');
    service.event('owner', 'added'); expect(logEvent).toHaveBeenCalledTimes(1);
  });
});
