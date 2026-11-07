import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { OverlayContainer } from '@angular/cdk/overlay';
import { BehaviorSubject, finalize, of } from 'rxjs';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import { TrainingGoalsDialogComponent } from './training-goals-dialog.component';
import { TrainingGoalDetailsComponent } from './training-goal-details.component';
import { EventDayGuidanceDialogComponent } from '../plans/event-day-guidance-dialog.component';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TrainingPlansService } from '../../services/training-plans.service';
import { TrainingGoalsService } from '../../services/training-goals.service';
import type { TrainingGoalV1 } from '@shared/training-goals';
import { copyFileSync, cpSync, readdirSync, writeFileSync } from 'node:fs';
const goal: TrainingGoalV1 = { schemaVersion: 1, id: 'one', revision: 1, createdAtMs: 1, updatedAtMs: 1, name: 'Athens marathon',
  kind: 'event', lifecycle: 'active', priority: 'high', startLocalDate: '2026-11-01', targetLocalDate: '2026-11-08',
  sportScope: 'all', sport: null, objective: 'Finish comfortably', planId: 'old', weeklyTarget: null };
async function setup(data: Record<string, unknown> = {}) {
  const user = signal<any>({ uid: 'owner', settings: { unitSettings: { distanceUnits: DistanceUnits.Miles, startOfTheWeek: 1 } } });
  const save = vi.fn().mockResolvedValue(goal), close = vi.fn();
  const progressResults = new BehaviorSubject({ status: 'ready', result: { progress: [] } });
  const stopProgress = vi.fn(), watchProgress = vi.fn(() => progressResults.pipe(finalize(stopProgress)));
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  await TestBed.configureTestingModule({ imports: [TrainingGoalsDialogComponent, NoopAnimationsModule], providers: [
    { provide: MAT_DIALOG_DATA, useValue: { uid: 'owner', ...data } }, { provide: MatDialogRef, useValue: { close } },
    { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
    { provide: AppUserService, useValue: { user } }, { provide: AppHapticsService, useValue: haptics },
    { provide: TrainingPlansService, useValue: { watchPlans: () => of([]) } },
    { provide: TrainingGoalsService, useValue: { watch: () => of({ status: 'ready', goals: [goal] }),
      watchProgress, save, invalidateProgress: vi.fn() } },
  ] }).compileComponents();
  const fixture = TestBed.createComponent(TrainingGoalsDialogComponent); fixture.detectChanges(); await fixture.whenStable();
  return { fixture, component: fixture.componentInstance, save, close, user, haptics, watchProgress, stopProgress };
}
describe('Calendar goal surfaces', () => {
  it('explains the preparation period and switches goal type through a compact menu', async () => {
    const { fixture, component, haptics } = await setup({ createDate: '2099-12-15' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Preparation starts'); expect(root.textContent).toContain('Event date');
    expect(root.textContent).toContain('from preparation start through the final day');
    expect(root.textContent).toContain('The calendar flag appears on this date.'); expect(root.querySelector('mat-select')).toBeNull();
    root.querySelector<HTMLButtonElement>('button[aria-label="Goal type: Event / race"]')!.click();
    fixture.detectChanges(); await fixture.whenStable();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    [...overlay.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent?.includes('Milestone'))!.click();
    fixture.detectChanges(); await fixture.whenStable();
    expect(component.fields().kind).toBe('milestone'); expect(root.textContent).toContain('Achieve by'); expect(haptics.selection).toHaveBeenCalledTimes(2);
    component.set('startLocalDate', '2099-12-16', false); fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Achieve by must be on or after preparation starts.');
    expect(component.parsed()).toBeNull(); component.set('kind', 'ongoing'); fixture.detectChanges();
    expect(root.textContent).toContain('No end date.'); expect(root.querySelectorAll('input[type="date"]')).toHaveLength(1);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });
  it('preserves collapsed plan/status edits and rejects busy or unchanged progress choices', async () => {
    const { fixture, component, haptics } = await setup({ createDate: '2099-12-15' });
    const region = fixture.nativeElement.querySelector('#goal-plan-status') as HTMLElement;
    expect(region.hidden).toBe(true);
    const disclosure = fixture.nativeElement.querySelector('[aria-controls="goal-plan-status"]') as HTMLButtonElement;
    disclosure.click(); fixture.detectChanges(); expect(region.hidden).toBe(false);
    component.set('lifecycle', 'paused'); disclosure.click(); fixture.detectChanges();
    expect(region.hidden).toBe(true); expect(component.fields().lifecycle).toBe('paused');
    component.edit(goal); fixture.detectChanges(); expect(region.hidden).toBe(false);
    haptics.selection.mockClear(); component.selectProgress('manual'); expect(haptics.selection).not.toHaveBeenCalled();
    component.busy.set(true); component.selectProgress('days'); expect(component.targetKind()).toBe('manual');
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('reads progress only while current goals are visible and follows changes to the saved week start', async () => {
    const { fixture, component, user, watchProgress, stopProgress } = await setup({ goal });
    expect(watchProgress).not.toHaveBeenCalled();
    component.editing.set(false); fixture.detectChanges();
    expect(watchProgress).toHaveBeenCalledExactlyOnceWith('owner', component.timeZone, 1);
    user.update(value => ({ ...value, displayName: 'Updated name' })); fixture.detectChanges();
    expect(watchProgress).toHaveBeenCalledOnce();
    user.update(value => ({ ...value, settings: { unitSettings: { startOfTheWeek: 0 } } })); fixture.detectChanges();
    expect(watchProgress).toHaveBeenLastCalledWith('owner', component.timeZone, 0); expect(stopProgress).toHaveBeenCalledOnce();
    component.archived.set(true); fixture.detectChanges(); expect(stopProgress).toHaveBeenCalledTimes(2);
    expect(component.progress().result).toBeNull();
    component.archived.set(false); fixture.detectChanges(); expect(watchProgress).toHaveBeenCalledTimes(3);
    component.edit(goal); fixture.detectChanges(); expect(stopProgress).toHaveBeenCalledTimes(3);
  });
  it('starts a future calendar goal today and validates before saving with silent typing', async () => {
    const { fixture, component, save, haptics } = await setup({ createDate: '2099-11-08' });
    expect(component.fields().startLocalDate).toBe(component.today); expect(component.fields().targetLocalDate).toBe('2099-11-08');
    expect(component.parsed()).toBeNull(); expect(haptics.selection).not.toHaveBeenCalled();
    const name = fixture.nativeElement.querySelector('input[maxlength="120"]') as HTMLInputElement;
    name.value = 'My marathon'; name.dispatchEvent(new Event('input')); fixture.detectChanges(); await fixture.whenStable();
    expect(component.parsed()?.name).toBe('My marathon'); expect(haptics.selection).not.toHaveBeenCalled();
    await component.save(); expect(save).toHaveBeenCalledOnce(); expect(haptics.success).toHaveBeenCalledOnce();
  });
  it('edits lifecycle and an unavailable plan, then starts a clean independent goal', async () => {
    const { component, haptics } = await setup({ goal });
    expect(component.selectedPlanMissing()).toBe(true);
    component.set('lifecycle', 'archived'); component.set('lifecycle', 'archived'); expect(haptics.selection).toHaveBeenCalledOnce();
    component.edit(); expect(component.fields()).toMatchObject({ objective: '', planId: null, priority: 'normal', lifecycle: 'active' });
    expect(component.previous()).toBeNull();
    component.set('kind', 'ongoing'); component.set('name', 'Weekly running', false); component.targetKind.set('distance'); component.targetValue.set(10);
    expect(component.parsed()?.weeklyTarget).toEqual({ kind: 'distance', value: 16093.44 });
    component.targetKind.set('days'); component.targetValue.set(8); expect(component.parsed()).toBeNull();
  });
  it('keeps failed saves reviewable and closes after account changes', async () => {
    const { component, save, user, close, haptics, fixture } = await setup({ goal });
    save.mockRejectedValueOnce(Error('This goal changed.')); await component.save();
    expect(component.error()).toContain('changed'); expect(component.editing()).toBe(true); expect(component.busy()).toBe(false);
    expect(haptics.error).toHaveBeenCalledOnce(); expect(haptics.success).not.toHaveBeenCalled();
    user.set({ uid: 'other' }); fixture.detectChanges(); expect(close).toHaveBeenCalledOnce();
  });
  it('renders shared compact goal details with incomplete progress and canonical units', async () => {
    await TestBed.configureTestingModule({ imports: [TrainingGoalDetailsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(TrainingGoalDetailsComponent);
    fixture.componentRef.setInput('goal', { ...goal, planName: 'Unavailable plan', kind: 'ongoing', targetLocalDate: null, weeklyTarget: { kind: 'days', value: 3 } });
    fixture.componentRef.setInput('progress', { kind: 'days', value: 2, target: 3, complete: true, partialWeek: true, met: false });
    fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('2 of 3 training days · partial week');
    fixture.componentRef.setInput('progress', { kind: 'days', value: 0, target: 3, complete: false }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Progress incomplete'); expect(fixture.nativeElement.textContent).not.toContain('0 of');
  });
  it('uses the saved distance unit in goal target and progress displays', async () => {
    await TestBed.configureTestingModule({ imports: [TrainingGoalDetailsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(TrainingGoalDetailsComponent);
    fixture.componentRef.setInput('goal', { ...goal, kind: 'ongoing', targetLocalDate: null, planName: null, weeklyTarget: { kind: 'distance', value: 10000 } });
    fixture.detectChanges(); expect(fixture.componentInstance.targetText()).toMatch(/10.*km.*per week/i);
    fixture.componentRef.setInput('units', { distanceUnits: DistanceUnits.Miles }); fixture.detectChanges();
    expect(fixture.componentInstance.targetText()).toMatch(/6\.2.*mi.*per week/i);
  });
  it('renders event guidance with no Add or Send action', async () => {
    const user = signal<any>({ uid: 'owner' }), close = vi.fn();
    await TestBed.configureTestingModule({ imports: [EventDayGuidanceDialogComponent], providers: [
      { provide: MAT_DIALOG_DATA, useValue: { uid: 'owner', advice: { events: [{ name: 'Marathon', localDate: '2026-11-08' }],
        rationale: 'Follow your practiced routine.', usedContext: ['Goals'], missingContext: [] } } },
      { provide: MatDialogRef, useValue: { close } }, { provide: AppUserService, useValue: { user } },
      { provide: AppHapticsService, useValue: { selection: vi.fn() } },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(EventDayGuidanceDialogComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Marathon');
    expect([...fixture.nativeElement.querySelectorAll('button')].map((el: any) => el.textContent.trim())).toEqual(['Close']);
    user.set(null); fixture.detectChanges(); expect(close).toHaveBeenCalledOnce();
  });
  it('exports the actual Material editor for optional responsive visual verification', async () => {
    const output = process.env.TRAINING_GOALS_QA_DIR;
    if (!output) return;
    const { fixture } = await setup();
    const dialog = TestBed.inject(MatDialog).open(TrainingGoalsDialogComponent, { data: { uid: 'owner', createDate: '2026-12-20' },
      width: '640px', maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100dvh - 16px)', autoFocus: false });
    const component = dialog.componentInstance;
    const { compile } = await import('sass');
    // The test compiler omits external component styles. Compile their source for this optional browser fixture.
    const componentStyles = [
      ['src/app/components/training-goals/training-goals.scss', 'app-training-goals-dialog'],
      ['src/app/components/shared/compact-select/compact-select.component.scss', 'app-compact-select'],
      ['src/app/components/shared/activity-filter-picker/activity-filter-picker.component.scss', 'app-activity-filter-picker'],
    ].map(([path, host]) => compile(path).css.replace(/:host\(([^)]+)\)/g, `${host}$1`).replace(/:host/g, host)).join('\n');
    const css = readdirSync('dist/browser').find(file => /^styles.*\.css$/.test(file))!;
    copyFileSync(`dist/browser/${css}`, `${output}/styles.css`);
    cpSync('dist/browser/media', `${output}/media`, { recursive: true });
    for (const kind of ['event', 'milestone', 'ongoing'] as const) {
      component.set('kind', kind); component.targetKind.set('days'); dialog.componentRef!.changeDetectorRef.detectChanges();
      await fixture.whenStable(); dialog.componentRef!.changeDetectorRef.detectChanges();
      const styles = [...document.querySelectorAll('style')].map(style => style.textContent).join('\n');
      const overlay = TestBed.inject(OverlayContainer).getContainerElement();
      overlay.querySelectorAll('input').forEach(input => input.setAttribute('value', input.value));
      for (const theme of ['light', 'dark']) {
        const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"><style>${styles}\n${componentStyles}</style></head><body class="app-hydrated ${theme === 'dark' ? 'dark-theme' : ''}">${overlay.outerHTML}</body></html>`;
        writeFileSync(`${output}/goal-${kind}-${theme}.html`, html);
      }
    }
    dialog.close();
  });
});
