import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { Auth } from 'app/firebase/auth';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls } from '@shared/day-workout';
import { AppUserService } from './app.user.service';
import { AppFunctionsService } from './app.functions.service';
import { DayWorkoutService, type DayWorkoutEditorDraft } from './day-workout.service';
const sdk = vi.hoisted(() => ({ authState: vi.fn() }));
vi.mock('app/firebase/auth', async original => ({ ...await original<typeof import('app/firebase/auth')>(), authState: sdk.authState }));

describe('DayWorkoutService owner-bound handoff', () => {
  it('hands off an unsaved draft once, clears it on sign-out and rechecks the owner after App Check', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-28T12:00Z'));
    try {
      const changes = new BehaviorSubject<{ uid: string } | null>({ uid: 'owner' }); sdk.authState.mockReturnValue(changes);
      const auth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'owner' } };
      const user = signal<{ uid: string } | null>({ uid: 'owner' });
      const controls = defaultDayWorkoutControls('2026-10-28', 'Europe/Helsinki');
      const draft = { title: 'Easy run', structure: { version: 1 as const, sport: ActivityTypes.Running,
        nodes: [{ kind: 'step' as const, id: 'work', purpose: 'work' as const, ending: { kind: 'time' as const, seconds: 1800 }, targets: [] }] } };
      const result: DayWorkoutEditorDraft = { ownerUid: 'owner', controls, draft, saveRequest: { mutationId: 'save-request',
        expectedRevisions: [{ scope: 'state', id: 'current', revision: 1 }], operation: { kind: 'create-workout', workoutId: 'stable-workout',
          planId: null, localDate: controls.localDate, title: draft.title, structure: draft.structure, confirmPlanRangeExtension: false } } };
      const navigate = vi.fn().mockResolvedValue(true), call = vi.fn().mockResolvedValue({ data: {} });
      const open = vi.fn().mockReturnValue({ afterClosed: () => of(result) });
      TestBed.configureTestingModule({ providers: [DayWorkoutService,
        { provide: Auth, useValue: auth }, { provide: AppUserService, useValue: { user } },
        { provide: Router, useValue: { navigate } }, { provide: MatDialog, useValue: { open } },
        { provide: AppFunctionsService, useValue: { call } },
      ] });
      const service = TestBed.inject(DayWorkoutService);
      await service.open('owner', controls.localDate);
      expect(navigate).toHaveBeenCalledWith(['/training/plans/standalone/new'], { queryParams: { date: controls.localDate } });
      expect(service.takeEditorDraft('owner', null, controls.localDate)).toEqual(result);
      expect(service.takeEditorDraft('owner', null, controls.localDate)).toBeNull();
      await service.open('owner', controls.localDate); auth.currentUser = null; user.set(null); changes.next(null);
      auth.currentUser = { uid: 'owner' }; user.set({ uid: 'owner' }); changes.next(auth.currentUser);
      expect(service.takeEditorDraft('owner', null, controls.localDate)).toBeNull();
      await service.generate('owner', { requestId: 'generation-request', controls }, () => true);
      expect(call.mock.calls[0][2].canExecute()).toBe(true);
      auth.currentUser = { uid: 'other' }; expect(call.mock.calls[0][2].canExecute()).toBe(false);
      await service.open('other', controls.localDate); expect(open).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
