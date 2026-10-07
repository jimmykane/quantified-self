import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';
import { DataRPE, DistanceUnits } from '@sports-alliance/sports-lib';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { WorkoutReflectionService } from '../../services/workout-reflection.service';
import { BrowserCompatibilityService } from '../../services/browser.compatibility.service';
import { WorkoutReflectionDialogComponent } from './workout-reflection-dialog.component';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Workout reflection editor', () => {
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const service = { read: vi.fn(), hasExactWorkoutLink: vi.fn(), save: vi.fn() };
  const browser = { createRandomUUID: vi.fn() };
  const ref = { close: vi.fn(), disableClose: false };
  const auth$ = new Subject<{ uid: string }>();
  const getStat = vi.fn();
  let component: WorkoutReflectionDialogComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<WorkoutReflectionDialogComponent>>;
  beforeEach(async () => {
    vi.clearAllMocks();
    getStat.mockReturnValue(null);
    browser.createRandomUUID.mockReturnValue('11111111-1111-4111-8111-111111111111');
    service.read.mockResolvedValue(null); service.hasExactWorkoutLink.mockResolvedValue(false); service.save.mockResolvedValue({});
    TestBed.configureTestingModule({ imports: [WorkoutReflectionDialogComponent, NoopAnimationsModule], providers: [
      { provide: MAT_DIALOG_DATA, useValue: { user: { uid: 'owner', settings: { unitSettings: { distanceUnits: DistanceUnits.Miles } } },
        event: { getID: () => 'event', getStat, getActivities: () => [
          { getID: () => 'run', type: 'Running' }, { getID: () => 'bike', type: 'Cycling' } ] } } },
      { provide: MatDialogRef, useValue: ref }, { provide: AppHapticsService, useValue: haptics },
      { provide: WorkoutReflectionService, useValue: service }, { provide: AppAuthService, useValue: { user$: auth$ } },
      { provide: BrowserCompatibilityService, useValue: browser },
    ] });
    fixture = TestBed.createComponent(WorkoutReflectionDialogComponent);
    component = fixture.componentInstance; fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  });
  it('hydrates silently without importing existing RPE or completing a workout; Skip never writes', () => {
    expect(fixture.nativeElement.querySelectorAll('mat-select')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[aria-label="Saved workout RPE"]').textContent).toContain('Not recorded');
    expect(component.note()).toBe(''); expect(component.changed()).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled(); expect(service.save).not.toHaveBeenCalled();
    component.cancel(); expect(service.save).not.toHaveBeenCalled(); expect(ref.close).toHaveBeenCalled();
  });
  it.each([
    { value: 0, distanceUnits: undefined },
    { value: 0, distanceUnits: DistanceUnits.Miles },
    { value: 0.5, distanceUnits: undefined },
    { value: 2.5, distanceUnits: DistanceUnits.Miles },
    { value: 10, distanceUnits: undefined },
  ])('shows workout RPE $value through canonical display with distance preference $distanceUnits', async ({ value, distanceUnits }) => {
    fixture.destroy();
    getStat.mockReturnValue(new DataRPE(value));
    TestBed.inject(MAT_DIALOG_DATA).user.settings.unitSettings = distanceUnits ? { distanceUnits } : undefined;
    fixture = TestBed.createComponent(WorkoutReflectionDialogComponent);
    component = fixture.componentInstance; fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const context = fixture.nativeElement.querySelector('[aria-label="Saved workout RPE"]');
    expect(context.textContent).toContain(resolveUnitAwareDisplayFromValue(DataRPE.type, value, component.data.user.settings.unitSettings)!.text);
    expect(context.textContent).not.toContain('Not recorded');
    expect(context.querySelector('input, select, mat-select, button')).toBeNull();
    expect(component.note()).toBe(''); expect(component.changed()).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled(); expect(service.save).not.toHaveBeenCalled();
  });
  it('keeps whole-recording RPE as context for activity reflections and saves only private fields', async () => {
    fixture.destroy();
    const workoutRpe = new DataRPE(5);
    getStat.mockReturnValue(workoutRpe);
    fixture = TestBed.createComponent(WorkoutReflectionDialogComponent);
    component = fixture.componentInstance; fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    await component.select('activity_bike'); fixture.detectChanges();
    const context = fixture.nativeElement.querySelector('[aria-label="Saved workout RPE"]');
    expect(context.textContent).toContain('For the whole recording');
    expect(context.textContent).toContain('Edit details');
    expect(context.textContent).toContain(resolveUnitAwareDisplayFromValue(DataRPE.type, 5, component.data.user.settings.unitSettings)!.text);
    expect(fixture.nativeElement.querySelectorAll('mat-select')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).not.toContain('Private reflection effort');
    component.note.set('Private session context'); await component.apply();
    expect(service.save).toHaveBeenCalledWith(expect.objectContaining({ target: 'activity', activityId: 'bike' }),
      0, expect.any(String), { note: 'Private session context' }, false);
    expect(workoutRpe.getValue()).toBe(5);
  });
  it.each([null, undefined, '5', NaN, -1, 11, Infinity])('shows invalid workout RPE %s as not recorded', async value => {
    fixture.destroy(); getStat.mockReturnValue({ getValue: () => value });
    fixture = TestBed.createComponent(WorkoutReflectionDialogComponent);
    component = fixture.componentInstance; fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.workoutRpeDisplay()).toBeNull(); expect(component.note()).toBe('');
    expect(fixture.nativeElement.querySelector('[aria-label="Saved workout RPE"]').textContent).toContain('Not recorded');
  });
  it('hydrates a saved note without adding another RPE input or changing workout RPE', async () => {
    fixture.destroy(); getStat.mockReturnValue(new DataRPE(5));
    service.read.mockResolvedValue({ schemaVersion: 1, revision: 1, deleted: false,
      mutationId: '11111111-1111-4111-8111-111111111111', note: 'Private note' });
    fixture = TestBed.createComponent(WorkoutReflectionDialogComponent);
    component = fixture.componentInstance; fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.note()).toBe('Private note'); expect(component.changed()).toBe(false);
    expect(fixture.nativeElement.querySelectorAll('mat-select')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[aria-label="Saved workout RPE"]').textContent)
      .toContain(resolveUnitAwareDisplayFromValue(DataRPE.type, 5, component.data.user.settings.unitSettings)!.text);
  });
  it('can render the actual dialog for phone/desktop visual QA without account data', async () => {
    if (!process.env.QS_REFLECTION_QA_HTML) return;
    const styleFile = readdirSync('dist/browser').find(name => /^styles(?:-[A-Z0-9]+)?\.css$/i.test(name));
    if (!styleFile) throw new Error('Build first for dialog QA.');
    const styles = readFileSync(`dist/browser/${styleFile}`, 'utf8');
    const componentStyles = readFileSync('src/app/components/workout-reflection/workout-reflection-dialog.component.scss', 'utf8')
      .replaceAll(':host', '.mat-mdc-dialog-container app-workout-reflection-dialog');
    const dialog = TestBed.inject(MatDialog).open(WorkoutReflectionDialogComponent, {
      data: component.data, width: 'min(38rem, calc(100vw - 32px))', maxWidth: 'calc(100vw - 32px)',
    });
    await fixture.whenStable(); fixture.detectChanges();
    const overlay = document.querySelector('.cdk-overlay-container')!.outerHTML;
    writeFileSync(process.env.QS_REFLECTION_QA_HTML, `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}\n${componentStyles}</style>${document.head.innerHTML}</head><body>${overlay}<script>if(location.hash==='#dark'){document.body.classList.add('dark-theme');document.querySelector('.cdk-overlay-container').classList.add('dark-theme')}</script></body></html>`);
    dialog.close();
  });

  it('pins the explicit activity target and gives one selection and post-success feedback', async () => {
    await component.select('activity_bike'); component.note.set('wind');
    await component.apply();
    expect(service.save).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event', activityId: 'bike', target: 'activity' }),
      0, expect.any(String), { note: 'wind' }, false);
    expect(haptics.selection).toHaveBeenCalledTimes(2); expect(haptics.success).toHaveBeenCalledOnce();
    expect(component.prompts().join()).toContain('wind');
  });
  it('keeps a failed draft and reuses the mutation identity for an uncertain retry', async () => {
    service.save.mockRejectedValueOnce(new Error('offline'));
    component.note.set('tired'); await component.apply(); await component.apply();
    expect(service.save.mock.calls[0][2]).toBe(service.save.mock.calls[1][2]);
    expect(browser.createRandomUUID).toHaveBeenCalledOnce();
    expect(component.note()).toBe('tired'); expect(haptics.error).toHaveBeenCalledOnce();
  });
  it('keeps the draft editable and reports an unavailable browser UUID without writing', async () => {
    browser.createRandomUUID.mockReturnValueOnce(null);
    component.note.set('tired');
    await component.apply();
    expect(component.error()).toContain('supported browser');
    expect(component.note()).toBe('tired'); expect(component.busy()).toBe(false);
    expect(service.save).not.toHaveBeenCalled(); expect(haptics.error).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled();
    await component.apply();
    expect(service.save).toHaveBeenCalledOnce(); expect(haptics.success).toHaveBeenCalledOnce();
  });
  it('requires deletion review and allows cancellation without writes', async () => {
    component.saved.set({ schemaVersion: 1, revision: 4, deleted: false, mutationId: '11111111-1111-4111-8111-111111111111', note: 'private' });
    await component.apply(true); expect(service.save).not.toHaveBeenCalled();
    component.reviewDelete(); component.cancelDelete(); expect(service.save).not.toHaveBeenCalled();
    component.reviewDelete(); await component.apply(true);
    expect(service.save).toHaveBeenCalledWith(expect.any(Object), 4, expect.any(String), expect.any(Object), true);
  });
  it('fails closed after a failed read and clears private content on account change', async () => {
    service.read.mockRejectedValueOnce(new Error('offline')); await component.load();
    component.note.set('draft'); await component.apply(); expect(service.save).not.toHaveBeenCalled();
    auth$.next({ uid: 'other' }); expect(component.note()).toBe(''); expect(component.saved()).toBeNull();
    expect(ref.close).toHaveBeenCalled();
  });
  it('ignores delayed save results after an account change', async () => {
    let fail!: (error: Error) => void;
    service.save.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    component.note.set('private draft'); const pending = component.apply();
    auth$.next({ uid: 'other' }); fail(new Error('old account conflict')); await pending;
    expect(component.error()).toBe(''); expect(component.note()).toBe('');
    expect(haptics.success).not.toHaveBeenCalled(); expect(haptics.error).not.toHaveBeenCalled();
  });

  it('does not show planned comparison from an unknown link and keeps selection no-ops silent', async () => {
    await component.select('recording'); expect(haptics.selection).not.toHaveBeenCalled();
    expect(component.prompts().join()).not.toContain('linked');
    expect(fixture.nativeElement.textContent).toContain('Read-only here; change it in Edit details');
  });
});
