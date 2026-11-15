import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { BreakpointObserver } from '@angular/cdk/layout';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesSetupComponent } from './preferences-setup.component';
import { PreferencesSetupService } from '../../services/preferences-setup.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { buildUnitSettingsForUnitSetupPreset } from '../../helpers/unit-setup-preset.helper';
import type { AppUserInterface } from '../../models/app-user.interface';

describe('PreferencesSetupComponent', () => {
  const makeState = () => ({ user: signal<AppUserInterface | null>({uid: 'owner', settings: {unitSettings: buildUnitSettingsForUnitSetupPreset('miles')}} as AppUserInterface),
    due: signal(true), busy: signal(false), error: signal(''), ownerRevision: signal(0), complete: vi.fn() });
  let state: ReturnType<typeof makeState>, open: ReturnType<typeof vi.fn>, closed: Subject<void>, handset: ReturnType<typeof vi.fn>;
  let haptics: {selection: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>};
  beforeEach(() => {
    state = makeState(); closed = new Subject(); open = vi.fn().mockReturnValue({afterClosed: () => closed}); handset = vi.fn().mockReturnValue(false);
    haptics = {selection: vi.fn(), error: vi.fn()};
    TestBed.configureTestingModule({ imports: [PreferencesSetupComponent, NoopAnimationsModule], providers: [
      {provide: PreferencesSetupService, useValue: state}, {provide: MatDialog, useValue: {open}},
      {provide: BreakpointObserver, useValue: {isMatched: handset, observe: () => of({matches: false, breakpoints: {}})}}, {provide: AppHapticsService, useValue: haptics},
    ] });
  });
  function render() { const fixture = TestBed.createComponent(PreferencesSetupComponent); fixture.detectChanges(); return fixture; }
  it('shows actual current defaults and dismisses through the shared completion action', async () => {
    const fixture = render();
    expect(fixture.nativeElement.textContent).toContain('Current: Miles · Kilograms (kg) · Monday');
    expect(fixture.nativeElement.textContent).not.toContain('Default units');
    const keep = [...fixture.nativeElement.querySelectorAll('button')].find((button: HTMLButtonElement) => button.textContent.includes('Keep defaults')) as HTMLButtonElement;
    keep.click(); await fixture.whenStable(); expect(state.complete).toHaveBeenCalledWith('owner');
    state.due.set(false); fixture.detectChanges(); expect(fixture.nativeElement.querySelector('mat-card')).toBeNull();
  });
  it('does not render on someone else’s dashboard or reopen after completion', () => {
    const fixture = render(); fixture.componentRef.setInput('ownerUid', 'other'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('mat-card')).toBeNull();
    fixture.componentRef.setInput('ownerUid', 'owner'); state.due.set(false); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('mat-card')).toBeNull(); expect(haptics.selection).not.toHaveBeenCalled();
  });
  it.each([false, true])('opens one explicit preferences review with handset=%s', async mobile => {
    handset.mockReturnValue(mobile); const fixture = render(); const component = fixture.componentInstance;
    await component.review(); await component.review();
    expect(open).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledOnce();
    expect(open.mock.calls[0][1]).toMatchObject({width: mobile ? '100vw' : '584px', data: {user: state.user()}});
    expect(component.dialogOpen()).toBe(true); closed.next(); expect(component.dialogOpen()).toBe(false);
  });
  it('retains an actionable error and prevents duplicate keep-defaults actions while saving', async () => {
    const fixture = render(); state.busy.set(true); state.error.set('Could not save'); fixture.detectChanges();
    await fixture.componentInstance.keepDefaults(); expect(state.complete).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Could not save');
    expect([...fixture.nativeElement.querySelectorAll('button')].every((button: HTMLButtonElement) => button.disabled)).toBe(true);
  });
  it('does not open a late-loaded dialog after an account transition', async () => {
    const fixture = render(); const pending = fixture.componentInstance.review(); state.ownerRevision.set(2);
    await pending; expect(open).not.toHaveBeenCalled();
  });
});
