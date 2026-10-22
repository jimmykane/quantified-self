import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { OverlayContainer } from '@angular/cdk/overlay';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { ActivityTypesFilterMenuComponent } from './activity-types-filter-menu.component';
import { ActivityTypesMultiSelectComponent } from '../activity-types-multi-select/activity-types-multi-select.component';
import { ActivityFilterPickerComponent } from '../shared/activity-filter-picker/activity-filter-picker.component';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';

async function setup(disabled = false) {
  const selection = vi.fn();
  TestBed.configureTestingModule({ declarations: [ActivityTypesFilterMenuComponent, ActivityTypesMultiSelectComponent],
    imports: [ActivityFilterPickerComponent, NoopAnimationsModule], providers: [
      { provide: AppHapticsService, useValue: { selection } },
      { provide: AppEventColorService, useValue: { getColorForActivityTypeByActivityTypeGroup: () => '#123456' } },
    ],
  });
  const fixture = TestBed.createComponent(ActivityTypesFilterMenuComponent);
  fixture.componentRef.setInput('selectedActivityTypes', [ActivityTypes.Running]);
  fixture.componentRef.setInput('availableActivityTypes', [ActivityTypes.Running, ActivityTypes.Treadmill]);
  fixture.componentRef.setInput('disabled', disabled); fixture.componentRef.setInput('ariaLabel', 'Filter tile activities');
  const emit = vi.spyOn(fixture.componentInstance.selectedActivityTypesChange, 'emit');
  const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
  await settle(); return { fixture, selection, emit, settle };
}

describe('ActivityTypesFilterMenuComponent', () => {
  it('uses a compact accessible trigger for the same searchable checkbox picker and restores focus', async () => {
    const c = await setup(); const button = c.fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Filter tile activities: Running');
    expect(c.fixture.nativeElement.querySelector('mat-form-field')).toBeNull();
    expect(c.selection).not.toHaveBeenCalled(); button.focus(); button.click(); await c.settle();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    expect(overlay.querySelector('input[aria-label="Search sports"]')).toBeTruthy();
    expect(overlay.querySelector('[aria-label="Running"]')?.getAttribute('aria-selected')).toBe('true');
    (overlay.querySelector('mat-checkbox input') as HTMLInputElement).click(); await c.settle();
    expect(c.emit).toHaveBeenLastCalledWith([ActivityTypes.Running, ActivityTypes.Treadmill]);
    expect(c.selection).toHaveBeenCalledTimes(2);
    [...overlay.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Clear selection')!.click(); await c.settle();
    expect(c.emit).toHaveBeenLastCalledWith([]); expect(button.getAttribute('aria-label')).toBe('Filter tile activities: All sports');
    [...overlay.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Done')!.click(); await c.settle();
    expect(document.activeElement).toBe(button);
  });

  it('does not open or emit while disabled and hydrates parent changes silently', async () => {
    const c = await setup(true); const button = c.fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click(); await c.settle(); expect(button.disabled).toBe(true);
    expect(TestBed.inject(OverlayContainer).getContainerElement().querySelector('[role="dialog"]')).toBeNull();
    c.fixture.componentRef.setInput('selectedActivityTypes', []); await c.settle();
    expect(button.getAttribute('aria-label')).toBe('Filter tile activities: All sports');
    expect(c.emit).not.toHaveBeenCalled(); expect(c.selection).not.toHaveBeenCalled();
  });
});
