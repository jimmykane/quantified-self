import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DistanceUnits, type User } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { ActivityAscentEditorComponent } from './activity-ascent-editor.component';
import { ActivityAscentService, type ActivityAscentRow } from '../../services/activity-ascent.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppAuthService } from '../../authentication/app.auth.service';

describe('ActivityAscentEditorComponent', () => {
  const row: ActivityAscentRow = { id: 'hike', label: 'Activity 1 · Hiking', value: 75,
    correction: { value: 75, sourceValue: 250 }, fingerprint: 'a'.repeat(64) };
  let load: ReturnType<typeof vi.fn>, save: ReturnType<typeof vi.fn>;
  let haptics: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let ref: { close: ReturnType<typeof vi.fn>; disableClose: boolean };
  let user$: BehaviorSubject<User | null>;
  beforeEach(() => {
    load = vi.fn().mockResolvedValue([row]); save = vi.fn().mockResolvedValue(undefined);
    haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    ref = { close: vi.fn(), disableClose: false };
  });
  async function render(distanceUnits = DistanceUnits.Kilometers) {
    const user = { uid: 'owner', settings: { unitSettings: normalizeUserUnitSettings({ distanceUnits }) } } as User;
    user$ = new BehaviorSubject(user);
    await TestBed.configureTestingModule({ imports: [ActivityAscentEditorComponent], providers: [
      { provide: MAT_DIALOG_DATA, useValue: { user, eventId: 'event' } },
      { provide: MatDialogRef, useValue: ref }, { provide: AppAuthService, useValue: { user$ } },
      { provide: ActivityAscentService, useValue: { load, save } }, { provide: AppHapticsService, useValue: haptics },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(ActivityAscentEditorComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    return fixture;
  }
  it.each([DistanceUnits.Kilometers, DistanceUnits.Miles])('renders edited/imported ascent using Sports Lib units with %s preferences', async units => {
    const fixture = await render(units);
    expect(fixture.nativeElement.textContent).toContain('Edited');
    expect(fixture.nativeElement.textContent).toContain('250 m');
    expect(fixture.componentInstance.unit).toBe('m');
    expect(fixture.nativeElement.querySelector('input').value).toBe('75');
    expect(haptics.selection).not.toHaveBeenCalled(); expect(haptics.success).not.toHaveBeenCalled();
  });
  it('rejects negative/empty input and saves zero with one selection and success feedback', async () => {
    const saved = { activityId: 'hike', ascent: 0, eventAscent: 0, correction: { value: 0, sourceValue: 250 } };
    save.mockResolvedValueOnce(saved);
    const fixture = await render(), component = fixture.componentInstance;
    component.edit(-1); expect(component.canSave()).toBe(false);
    component.edit(null); expect(component.canSave()).toBe(false);
    component.edit(0); expect(haptics.selection).not.toHaveBeenCalled();
    await component.save();
    expect(save).toHaveBeenCalledWith('owner', 'event', row, 0);
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(haptics.success).toHaveBeenCalledOnce();
    expect(ref.close).toHaveBeenCalledWith(saved);
  });
  it('reviews reset locally and restores the imported value only after Save', async () => {
    const component = (await render()).componentInstance;
    component.restore();
    expect(component.value()).toBe(250); expect(save).not.toHaveBeenCalled();
    await component.save();
    expect(save).toHaveBeenCalledWith('owner', 'event', row, null);
  });
  it('keeps the editor open with the entered value when a stale save fails', async () => {
    save.mockRejectedValue(new Error('The activity changed. Reload it before saving ascent.'));
    const fixture = await render(), component = fixture.componentInstance;
    component.edit(100); await component.save(); fixture.detectChanges();
    expect(component.value()).toBe(100); expect(component.busy()).toBe(false);
    expect(ref.close).not.toHaveBeenCalled(); expect(haptics.error).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Reload');
  });
  it('keeps the selected activity when reloading a multi-activity recording', async () => {
    const second = { ...row, id: 'walk', label: 'Activity 2 · Walking', value: 100 };
    load.mockResolvedValue([row, second]);
    const fixture = await render(), component = fixture.componentInstance;
    component.select('walk'); component.edit(150);
    load.mockResolvedValueOnce([row, { ...second, value: 110 }]);
    await component.load(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.selectedId()).toBe('walk');
    expect(fixture.nativeElement.querySelector('input').value).toBe('110');
    expect(component.canSave()).toBe(false);
  });
  it('disables stale saves if a reload fails, then restores the selected activity on retry', async () => {
    const second = { ...row, id: 'walk', label: 'Activity 2 · Walking', value: 100 };
    load.mockResolvedValue([row, second]);
    const component = (await render()).componentInstance;
    component.select('walk'); component.edit(150);
    load.mockRejectedValueOnce(new Error('Offline'));
    await component.load();
    expect(component.error()).toBe('Offline');
    expect(component.canSave()).toBe(false);
    await component.save(); expect(save).not.toHaveBeenCalled();
    await component.load();
    expect(component.selectedId()).toBe('walk'); expect(component.value()).toBe(100);
  });
  it('does not submit twice or report success after the owner changes during a save', async () => {
    let finish!: () => void;
    save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const component = (await render()).componentInstance;
    component.edit(100); const pending = component.save(); await component.save();
    expect(save).toHaveBeenCalledOnce(); expect(ref.disableClose).toBe(true);
    user$.next(null); finish(); await pending;
    expect(component.rows()).toEqual([]); expect(haptics.success).not.toHaveBeenCalled();
    expect(ref.close).toHaveBeenCalledWith();
  });
});
