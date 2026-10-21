import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { OverlayContainer } from '@angular/cdk/overlay';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { CompatibleTrainingActivityTypes } from '@shared/activity-type-compatibility';
import { ActivityTypesMultiSelectComponent } from './activity-types-multi-select.component';
import { ActivityFilterPickerComponent } from '../shared/activity-filter-picker/activity-filter-picker.component';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';

describe('ActivityTypesMultiSelectComponent', () => {
  const create = () => {
    const selection = vi.fn();
    const component = new ActivityTypesMultiSelectComponent({ selection } as unknown as AppHapticsService);
    const emitted: ActivityTypes[][] = [];
    component.selectedActivityTypesChange.subscribe(value => emitted.push(value));
    return { component, selection, emitted };
  };

  it('hydrates exact subsets and aliases silently and offers supported catalog types', () => {
    const c = create(); c.component.selectedActivityTypes = ['cycling' as ActivityTypes]; c.component.ngOnChanges();
    expect(c.component.selectedActivityTypes).toEqual([ActivityTypes.Cycling]);
    expect(c.component.options.some(option => option.value === ActivityTypes.Snorkeling)).toBe(true);
    expect(c.component.options.some(option => option.value === ActivityTypes.Mermaiding)).toBe(true);
    c.component.ngOnChanges(); expect(c.emitted).toEqual([]); expect(c.selection).not.toHaveBeenCalled();
  });

  it('retains selected no-match sports and catalog bridges, with no families for an empty context', () => {
    const c = create(); c.component.availableActivityTypes = [];
    c.component.selectedActivityTypes = [CompatibleTrainingActivityTypes.RoadRunning]; c.component.ngOnChanges();
    expect(c.component.options.map(option => option.value)).toEqual([CompatibleTrainingActivityTypes.RoadRunning]);
    expect(c.component.shortcuts).toEqual([]); expect(c.emitted).toEqual([]); expect(c.selection).not.toHaveBeenCalled();
    c.component.selectSports([]);
    expect(c.component.options).toEqual([]); expect(c.emitted).toEqual([[]]); expect(c.selection).toHaveBeenCalledOnce();
  });

  it('limits context choices, preserves active no-match choices and ignores invalid new sports', () => {
    const c = create(); c.component.availableActivityTypes = [ActivityTypes.Cycling];
    c.component.selectedActivityTypes = [ActivityTypes.Running]; c.component.ngOnChanges();
    expect(c.component.options.map(option => option.value)).toEqual([ActivityTypes.Cycling, ActivityTypes.Running]);
    c.component.selectSports([ActivityTypes.Yoga]);
    expect(c.component.selectedActivityTypes).toEqual([]); expect(c.emitted).toEqual([[]]);
    expect(c.component.options.map(option => option.value)).toEqual([ActivityTypes.Cycling]);
  });

  it('accepts changed multi-selections once, clears immediately and ignores disabled actions', () => {
    const c = create(); c.component.ngOnChanges();
    c.component.selectSports([ActivityTypes.Running, ActivityTypes.Cycling]);
    c.component.selectSports([ActivityTypes.Cycling, ActivityTypes.Running]);
    expect(c.emitted).toEqual([[ActivityTypes.Running, ActivityTypes.Cycling]]); expect(c.selection).toHaveBeenCalledOnce();
    c.component.selectSports([]); expect(c.component.selectedActivityTypes).toEqual([]); expect(c.selection).toHaveBeenCalledTimes(2);
    c.component.disabled = true; c.component.selectSports([ActivityTypes.Running]); expect(c.selection).toHaveBeenCalledTimes(2);
  });

  it('retains locked sports through clearing and ignores unchanged input hydration', () => {
    const c = create(); c.component.lockedActivityTypes = [ActivityTypes.Diving];
    c.component.selectedActivityTypes = [ActivityTypes.Running]; c.component.ngOnChanges();
    expect(c.component.selectedActivityTypes).toEqual([ActivityTypes.Running, ActivityTypes.Diving]);
    expect(c.component.options.find(option => option.value === ActivityTypes.Diving)?.disabled).toBe(true);
    expect(c.emitted).toEqual([]); c.component.selectSports([]);
    expect(c.emitted).toEqual([[ActivityTypes.Diving]]); c.component.selectSports([]); c.component.ngOnChanges();
    expect(c.selection).toHaveBeenCalledOnce();
  });

  it('uses the shared dialog, sport icons, search and semantic family checkbox events', async () => {
    const selection = vi.fn();
    TestBed.configureTestingModule({ declarations: [ActivityTypesMultiSelectComponent], imports: [ActivityFilterPickerComponent, NoopAnimationsModule], providers: [
      { provide: AppHapticsService, useValue: { selection } },
      { provide: AppEventColorService, useValue: { getColorForActivityTypeByActivityTypeGroup: () => '#123456' } },
    ] });
    const fixture = TestBed.createComponent(ActivityTypesMultiSelectComponent);
    fixture.componentRef.setInput('selectedActivityTypes', [ActivityTypes.Running]);
    fixture.componentRef.setInput('availableActivityTypes', [ActivityTypes.Running, ActivityTypes.Treadmill]);
    const emit = vi.spyOn(fixture.componentInstance.selectedActivityTypesChange, 'emit');
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
    await settle(); expect(selection).not.toHaveBeenCalled();
    const trigger = fixture.nativeElement.querySelector('input') as HTMLInputElement; trigger.focus(); trigger.click(); await settle();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    expect(overlay.querySelector('input[aria-label="Search sports"]')).toBeTruthy();
    expect(overlay.querySelectorAll('app-activity-type-icon')).toHaveLength(2);
    const family = overlay.querySelector('mat-checkbox input') as HTMLInputElement;
    expect(family.indeterminate).toBe(true); family.click(); await settle();
    expect(fixture.componentInstance.selectedActivityTypes).toEqual([ActivityTypes.Running, ActivityTypes.Treadmill]);
    expect(emit).toHaveBeenCalledOnce(); expect(selection).toHaveBeenCalledTimes(2);
    expect(family.checked).toBe(true); expect(family.indeterminate).toBe(false);
    const clear = [...overlay.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Clear selection')!;
    clear.click(); await settle(); expect(trigger.value).toBe('All sports'); expect(emit).toHaveBeenCalledTimes(2);
    [...overlay.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Done')!.click(); await settle();
    expect(document.activeElement).toBe(trigger);
  });
});
