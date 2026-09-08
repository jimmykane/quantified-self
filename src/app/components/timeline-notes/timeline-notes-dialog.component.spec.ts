import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatCheckbox } from '@angular/material/checkbox';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineNotesDialogComponent } from './timeline-notes-dialog.component';
import { AppTimelineNotesService } from '../../services/app.timeline-notes.service';
import { BrowserCompatibilityService } from '../../services/browser.compatibility.service';
import { AppHapticsService } from '../../services/app.haptics.service';

describe('Timeline notes editor', () => {
  const note = { id: 'a'.repeat(64), category: 'sickness' as const, title: 'Sickness', startDate: '2026-01-01', endDate: null, timeZone: 'Europe/Helsinki', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
  const service = { uid: signal('owner'), showOnCharts: signal(true), setShowOnCharts: vi.fn(), list: vi.fn(), save: vi.fn(), remove: vi.fn(), get: vi.fn(), isOwner: () => true };
  let component: TimelineNotesDialogComponent;
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
  beforeEach(() => {
    service.showOnCharts.set(true);
    vi.clearAllMocks(); service.list.mockResolvedValue({ notes: [note], cursor: null }); service.save.mockResolvedValue(note);
    TestBed.configureTestingModule({ providers: [
      { provide: MAT_DIALOG_DATA, useValue: { uid: 'owner', notes: [note] } },
      { provide: AppHapticsService, useValue: haptics },
      { provide: MatDialogRef, useValue: { close: vi.fn() } }, { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(true) }) } },
      { provide: AppTimelineNotesService, useValue: service }, { provide: BrowserCompatibilityService, useValue: { createRandomUUID: () => '123e4567-e89b-42d3-a456-426614174000' } },
    ] });
    component = TestBed.runInInjectionContext(() => new TimelineNotesDialogComponent());
  });
  it('defaults new and legacy notes to visible and saves an individual choice only on Save', async () => {
    const fixture = TestBed.createComponent(TimelineNotesDialogComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.form.controls.showOnCharts.value).toBe(true);
    const checkbox = fixture.debugElement.query(By.directive(MatCheckbox));
    expect(checkbox.nativeElement.textContent).toContain('Show this note on charts and calendar');
    expect(checkbox.nativeElement.closest('.note-visibility')?.querySelector('#note-visibility-hint')).toBeTruthy();
    expect(checkbox.nativeElement.querySelector('input').getAttribute('aria-describedby')).toContain('note-visibility-hint');
    checkbox.nativeElement.querySelector('input').click();
    expect(fixture.componentInstance.form.controls.showOnCharts.value).toBe(false);
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(service.save).not.toHaveBeenCalled();
    expect(service.setShowOnCharts).not.toHaveBeenCalled();
    await fixture.componentInstance.save();
    expect(service.save).toHaveBeenCalledWith('owner', expect.objectContaining({ showOnCharts: false, mode: 'update', expectedRevision: 1 }));
    fixture.componentInstance.edit(null);
    expect(fixture.componentInstance.form.controls.showOnCharts.value).toBe(true);
  });
  it('keeps hidden notes editable in the manager and explains the global override', async () => {
    service.showOnCharts.set(false);
    service.list.mockResolvedValueOnce({ notes: [{ ...note, showOnCharts: false }], cursor: null });
    const fixture = TestBed.createComponent(TimelineNotesDialogComponent);
    await fixture.componentInstance.showList(); fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('.note-row') as HTMLButtonElement;
    expect(row.textContent).toContain('Hidden');
    row.click(); fixture.detectChanges();
    expect(fixture.componentInstance.form.controls.showOnCharts.value).toBe(false);
    expect(fixture.nativeElement.querySelector('#note-visibility-hint').textContent).toContain('global setting');
    expect(fixture.debugElement.query(By.directive(MatCheckbox)).componentInstance.disabled).toBe(false);
    fixture.componentInstance.busy.set(true); fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(MatCheckbox)).componentInstance.disabled).toBe(true);
  });
  it('preserves an unsaved visibility choice after failure and restores it on conflict reload', async () => {
    component.form.controls.showOnCharts.setValue(false);
    service.save.mockRejectedValueOnce({ code: 'functions/aborted' });
    await component.save();
    expect(component.form.controls.showOnCharts.value).toBe(false);
    expect(component.conflict()).toBe(true);
    service.get.mockResolvedValueOnce({ ...note, revision: 2, showOnCharts: true });
    await component.reloadNote();
    expect(component.form.controls.showOnCharts.value).toBe(true);
    component.edit({ ...note, showOnCharts: false });
    await component.endToday();
    expect(service.save).toHaveBeenLastCalledWith('owner', expect.objectContaining({ showOnCharts: false, endDate: expect.any(String) }));
  });
  it('opens a selected note, preserves its timezone, and closes an ongoing period', async () => {
    expect(component.view()).toBe('edit'); expect(component.mode()).toBe('ongoing');
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
    await component.endToday();
    expect(service.save).toHaveBeenCalledWith('owner', expect.objectContaining({ mode: 'update', timeZone: 'Europe/Helsinki', expectedRevision: 1, endDate: expect.any(String) }));
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(haptics.success).toHaveBeenCalledOnce();
  });
  it('preserves unsaved input and supports explicit conflict reload', async () => {
    component.form.controls.title.setValue('My draft');
    service.save.mockRejectedValueOnce({ code: 'functions/aborted' });
    await component.save();
    expect(haptics.error).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled();
    expect(component.form.controls.title.value).toBe('My draft'); expect(component.conflict()).toBe(true);
    service.get.mockResolvedValueOnce({ ...note, title: 'Remote edit', revision: 2 });
    await component.reloadNote();
    expect(component.form.controls.title.value).toBe('Remote edit'); expect(component.existing()?.revision).toBe(2);
  });
  it('creates a future single day and only prefills unchanged category titles', async () => {
    component.edit(null); component.form.controls.category.setValue('vacation'); component.categoryChanged('vacation');
    expect(component.form.controls.title.value).toBe('Vacation');
    component.form.patchValue({ title: 'Summer trip', startDate: '2027-06-01' }); component.categoryChanged('travel');
    expect(component.form.controls.title.value).toBe('Summer trip');
    await component.save();
    expect(service.save).toHaveBeenCalledWith('owner', expect.objectContaining({ mode: 'create', startDate: '2027-06-01', endDate: '2027-06-01' }));
  });
  it('uses a confirmed revision-checked delete', async () => {
    await component.remove(); expect(service.remove).toHaveBeenCalledWith('owner', { noteId: note.id, expectedRevision: 1 });
    expect(haptics.success).toHaveBeenCalledOnce();
  });
  it('keeps busy submissions silent and uses only error feedback for invalid date ranges', async () => {
    component.busy.set(true);
    await component.save();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
    component.busy.set(false);
    component.mode.set('range');
    component.form.controls.endDate.setValue('2025-12-31');
    await component.save();
    expect(service.save).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).toHaveBeenCalledOnce();
  });
  it('restores the Material checkbox when saving chart visibility fails', async () => {
    service.setShowOnCharts.mockRejectedValueOnce(new Error('offline'));
    const fixture = TestBed.createComponent(TimelineNotesDialogComponent);
    await fixture.componentInstance.showList(); fixture.detectChanges();
    const checkbox = fixture.debugElement.query(By.directive(MatCheckbox));
    checkbox.nativeElement.querySelector('input').click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(service.setShowOnCharts).toHaveBeenCalledWith('owner', false);
    expect(checkbox.componentInstance.checked).toBe(true);
    expect(fixture.componentInstance.error()).toContain('Could not save chart visibility');
  });
  it('retries the failed history page rather than silently returning to the previous page', async () => {
    const cursor = {};
    service.list.mockResolvedValueOnce({ notes: [note], cursor });
    const fixture = TestBed.createComponent(TimelineNotesDialogComponent);
    await fixture.componentInstance.showList(); fixture.detectChanges();
    service.list.mockRejectedValueOnce(new Error('offline'));
    await fixture.componentInstance.loadPage(1); fixture.detectChanges();
    const retry = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.trim() === 'Retry')!;
    retry.click(); await fixture.whenStable();
    expect(service.list).toHaveBeenLastCalledWith('owner', cursor);
  });
});
