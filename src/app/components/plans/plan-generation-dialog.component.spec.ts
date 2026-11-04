import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Auth } from 'app/firebase/auth';
import type { TrainingGoalV1 } from '@shared/training-goals';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AssistantQuotaService } from '../../services/assistant-quota.service';
import { TrainingGoalsService, type TrainingGoalsState } from '../../services/training-goals.service';
import { PlanGenerationDialogComponent } from './plan-generation-dialog.component';
import { ActivityFilterPickerComponent } from '../shared/activity-filter-picker/activity-filter-picker.component';
const sdk = vi.hoisted(() => ({ authState: vi.fn() }));
vi.mock('app/firebase/auth', async original => ({ ...await original<typeof import('app/firebase/auth')>(), authState: sdk.authState }));
const goal: TrainingGoalV1 = { id: 'race', name: 'Spring race', schemaVersion: 1, revision: 1, kind: 'event', lifecycle: 'active',
  priority: 'high', startLocalDate: '2026-11-04', targetLocalDate: '2027-03-01', sportScope: 'all', sport: null, objective: '',
  planId: null, weeklyTarget: null, createdAtMs: 1, updatedAtMs: 1 };
async function setup(goals: TrainingGoalV1[] = [], remaining = 88, notes = true) {
  const auth = { currentUser: { uid: 'owner' } }, changes = new BehaviorSubject(auth.currentUser); sdk.authState.mockReturnValue(changes);
  const state = new BehaviorSubject<TrainingGoalsState>({ status: 'ready', goals });
  const close = vi.fn(), open = vi.fn().mockResolvedValue(undefined), haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  await TestBed.configureTestingModule({ imports: [PlanGenerationDialogComponent, MatIconTestingModule], providers: [provideRouter([]),
    { provide: Auth, useValue: auth }, { provide: MAT_DIALOG_DATA, useValue: { uid: 'owner' } }, { provide: MatDialogRef, useValue: { close } },
    { provide: AppUserService, useValue: { user: signal({ uid: 'owner', settings: { appSettings: { dailyWorkoutSuggestion: { controls: { timelineContext: notes } } } } }) } },
    { provide: TrainingGoalsService, useValue: { watch: () => state, open } }, { provide: AppHapticsService, useValue: haptics },
    { provide: AssistantQuotaService, useValue: { loadQuotaStatus: vi.fn().mockResolvedValue({ remainingCount: remaining, limit: 100, isEligible: true }) } },
  ] }).compileComponents();
  const fixture = TestBed.createComponent(PlanGenerationDialogComponent); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, close, open, state, haptics, auth, changes };
}
describe('PlanGenerationDialogComponent', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T12:00:00Z')); });
  afterEach(() => vi.useRealTimers());
  it('uses shared sport selection and routine defaults, with optional goal creation and an editable handoff', async () => {
    const { fixture, component, open, close, haptics } = await setup();
    component.selectGoals([]); component.update('sport', null, true);
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(fixture.debugElement.query(By.directive(ActivityFilterPickerComponent)).componentInstance.multiple()).toBe(false);
    expect(component.options()).toMatchObject({ startLocalDate: '2026-11-09', weeks: 4, sport: null, days: null, minutes: null, timelineNotesEnabled: true });
    expect(fixture.nativeElement.textContent).toContain('88 of 100 remaining');
    const create: HTMLButtonElement = [...fixture.nativeElement.querySelectorAll('button')].find((button: HTMLButtonElement) => button.textContent?.trim() === 'Create goal');
    create.click(); await fixture.whenStable();
    expect(open).toHaveBeenCalledWith('owner', '2026-11-09'); expect(close).not.toHaveBeenCalled();
    component.continue();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ timelineNotesEnabled: true, prompt: expect.stringContaining('Goal focus: none.') }));
    expect(close.mock.lastCall[0].prompt).toContain('2026-12-06');
  });
  it('supports several live goals without reselecting intentionally cleared goals', async () => {
    const { component, state, close } = await setup([goal]);
    expect(component.goalIds()).toEqual(['race']);
    const second = { ...goal, id: 'strength', name: 'Strength consistency', priority: 'normal' as const };
    state.next({ status: 'ready', goals: [goal, second] }); component.selectGoals(['race', 'strength']);
    component.continue(); expect(close.mock.lastCall[0].prompt).toContain('"Spring race", "Strength consistency"');
    component.selectGoals([]); state.next({ status: 'ready', goals: [goal, second] });
    expect(component.goalIds()).toEqual([]);
    component.selectGoals(['race']); state.next({ status: 'error', goals: [] });
    expect(component.canContinue()).toBe(false);
  });
  it('validates manual days and respects the Timeline notes choice', async () => {
    const { fixture, component, close } = await setup([], 88, false);
    const routine = fixture.debugElement.queryAll(By.directive(MatCheckbox))[0].componentInstance as MatCheckbox;
    routine.change.emit({ source: routine, checked: false }); fixture.detectChanges();
    expect(component.canContinue()).toBe(false);
    component.toggleDay(1, true); component.update('minutes', 45); component.continue();
    expect(close.mock.lastCall[0]).toEqual({ timelineNotesEnabled: false, prompt: expect.stringContaining('Training days: Mon.') });
    expect(close.mock.lastCall[0].prompt).toContain('Session limit: 45 minutes.');
    expect(close.mock.lastCall[0].prompt).toContain('Do not use Timeline notes.');
  });
  it('blocks depleted allowance and closes without a draft on account changes', async () => {
    const { component, close, auth, changes } = await setup([], 0);
    component.continue(); expect(close).not.toHaveBeenCalled();
    auth.currentUser = { uid: 'other' }; changes.next(auth.currentUser);
    expect(close).toHaveBeenCalledWith();
    component.continue(); expect(close).toHaveBeenCalledTimes(1);
  });
});
