import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';
import { DistanceUnits } from '@sports-alliance/sports-lib';
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
  let component: WorkoutReflectionDialogComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<WorkoutReflectionDialogComponent>>;
  beforeEach(async () => {
    vi.clearAllMocks();
    browser.createRandomUUID.mockReturnValue('11111111-1111-4111-8111-111111111111');
    service.read.mockResolvedValue(null); service.hasExactWorkoutLink.mockResolvedValue(false); service.save.mockResolvedValue({});
    TestBed.configureTestingModule({ imports: [WorkoutReflectionDialogComponent, NoopAnimationsModule], providers: [
      { provide: MAT_DIALOG_DATA, useValue: { user: { uid: 'owner', settings: { unitSettings: { distanceUnits: DistanceUnits.Miles } } },
        event: { getID: () => 'event', getActivities: () => [
          { getID: () => 'run', type: 'Running' }, { getID: () => 'bike', type: 'Cycling' } ] } } },
      { provide: MatDialogRef, useValue: ref }, { provide: AppHapticsService, useValue: haptics },
      { provide: WorkoutReflectionService, useValue: service }, { provide: AppAuthService, useValue: { user$: auth$ } },
      { provide: BrowserCompatibilityService, useValue: browser },
    ] });
    fixture = TestBed.createComponent(WorkoutReflectionDialogComponent);
    component = fixture.componentInstance; fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  });
  it('hydrates silently without importing existing RPE or completing a workout; Skip never writes', () => {
    expect(fixture.nativeElement.textContent).toContain('Not reported');
    expect(component.effort()).toBeNull(); expect(component.options[0].value).toBe(0);
    expect(haptics.selection).not.toHaveBeenCalled(); expect(service.save).not.toHaveBeenCalled();
    component.cancel(); expect(service.save).not.toHaveBeenCalled(); expect(ref.close).toHaveBeenCalled();
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
    await component.select('activity_bike'); component.setEffort(0); component.note.set('wind');
    await component.apply();
    expect(service.save).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event', activityId: 'bike', target: 'activity' }),
      0, expect.any(String), { effort: 0, note: 'wind' }, false);
    expect(haptics.selection).toHaveBeenCalledTimes(3); expect(haptics.success).toHaveBeenCalledOnce();
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
    component.saved.set({ schemaVersion: 1, revision: 4, deleted: false, mutationId: '11111111-1111-4111-8111-111111111111', effort: 5, note: 'private' });
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
    expect(fixture.nativeElement.textContent).toContain('Imported and prescribed RPE stay separate');
  });
});
