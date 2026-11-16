import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminBillingPolicyComponent } from './admin-billing-policy.component';
import { AdminBillingTrialPolicyService } from '../../../services/admin-billing-trial-policy.service';
import { AppHapticsService } from '../../../services/app.haptics.service';

describe('AdminBillingPolicyComponent', () => {
  const view = { policy: { revision: 0, basicTrialDays: null, proTrialDays: null }, updatedBy: null, updatedAt: null };
  const service = { currentUid: vi.fn(), watchOwner: vi.fn(), read: vi.fn(), save: vi.fn() };
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  const dialog = { open: vi.fn() };
  let ownerChange: (uid: string | null) => void;
  const close = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); service.currentUid.mockReturnValue('admin'); service.read.mockResolvedValue(view); service.save.mockResolvedValue(undefined);
    service.watchOwner.mockImplementation(callback => { ownerChange = callback; return vi.fn(); });
    dialog.open.mockReturnValue({ afterClosed: () => of(true), close });
    TestBed.configureTestingModule({ imports: [AdminBillingPolicyComponent, NoopAnimationsModule], providers: [provideRouter([]),
      { provide: AdminBillingTrialPolicyService, useValue: service }, { provide: AppHapticsService, useValue: haptics }, { provide: MatDialog, useValue: dialog }] });
  });
  async function render() {
    TestBed.overrideProvider(MatDialog, { useValue: dialog });
    const fixture = TestBed.createComponent(AdminBillingPolicyComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    return fixture;
  }
  it('renders plan choices, preserves initialization silence and guards no-op selections', async () => {
    const fixture = await render(), component = fixture.componentInstance;
    expect(fixture.nativeElement.textContent).toContain('Basic free trial');
    expect(fixture.nativeElement.textContent).toContain('Pro free trial');
    expect(fixture.nativeElement.querySelectorAll('app-compact-select')).toHaveLength(2);
    expect(component.canSave()).toBe(false); component.select('basic', 'default');
    expect(haptics.selection).not.toHaveBeenCalled();
    component.select('basic', '0'); fixture.detectChanges();
    expect(component.canSave()).toBe(true); expect(haptics.selection).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain('no free trial; payment starts at checkout');
  });
  it('reviews exact terms and only saves after confirmation', async () => {
    const fixture = await render(), component = fixture.componentInstance;
    component.select('basic', '0'); component.select('pro', '14');
    await component.save(); fixture.detectChanges();
    expect(dialog.open.mock.calls[0][1].data.message).toContain('Pro: 14-day free trial');
    expect(service.save).toHaveBeenCalledWith({ revision: 0, basicTrialDays: 0, proTrialDays: 14 }, 'admin');
    expect(haptics.success).toHaveBeenCalledOnce(); expect(component.canSave()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Trial settings saved');
  });
  it('keeps cancel silent and prevents duplicate saves during review', async () => {
    const fixture = await render(), component = fixture.componentInstance;
    const review = new Subject<boolean>(); dialog.open.mockReturnValue({ afterClosed: () => review, close });
    component.select('pro', '7'); const pending = component.save(); await component.save();
    expect(dialog.open).toHaveBeenCalledOnce(); review.next(false); await pending;
    expect(service.save).not.toHaveBeenCalled(); expect(haptics.success).not.toHaveBeenCalled(); expect(component.canSave()).toBe(true);
  });
  it('requires a refresh after a failed or conflicting save', async () => {
    const fixture = await render(), component = fixture.componentInstance;
    service.save.mockRejectedValue(new Error('revision changed')); component.select('pro', '0'); await component.save(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Refresh');
    expect(component.canSave()).toBe(false); expect(haptics.error).toHaveBeenCalledOnce(); expect(haptics.success).not.toHaveBeenCalled();
  });
  it('closes review and drops pending mutations after an account change', async () => {
    const fixture = await render(), component = fixture.componentInstance;
    const review = new Subject<boolean>(); dialog.open.mockReturnValue({ afterClosed: () => review, close });
    component.select('pro', '0'); const pending = component.save(); ownerChange('other'); review.next(true); await pending;
    expect(close).toHaveBeenCalled(); expect(service.save).not.toHaveBeenCalled(); expect(component.data()).toBeNull();
  });
  it('discards late save feedback after destruction', async () => {
    const fixture = await render(), component = fixture.componentInstance;
    let finish!: () => void; service.save.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    component.select('pro', '0'); const pending = component.save(); await Promise.resolve(); fixture.destroy(); finish(); await pending;
    expect(haptics.success).not.toHaveBeenCalled();
  });
});
