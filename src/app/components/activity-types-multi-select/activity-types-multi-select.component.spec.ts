import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatCheckbox, MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { SimpleChange } from '@angular/core';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { ActivityTypesMultiSelectComponent } from './activity-types-multi-select.component';
import { CompatibleTrainingActivityTypes } from '@shared/activity-type-compatibility';

describe('ActivityTypesMultiSelectComponent', () => {
  function createComponent(): ActivityTypesMultiSelectComponent {
    const component = new ActivityTypesMultiSelectComponent({} as any);
    component.ngOnInit();
    return component;
  }

  it('does not reset the form control for equivalent selected activity inputs', () => {
    const component = createComponent();
    const setValueSpy = vi.spyOn(component.activityTypesControl, 'setValue');

    component.selectedActivityTypes = [ActivityTypes.Running];
    component.ngOnChanges({
      selectedActivityTypes: new SimpleChange(undefined, [ActivityTypes.Running], true),
    });

    component.selectedActivityTypes = [ActivityTypes.Running];
    component.ngOnChanges({
      selectedActivityTypes: new SimpleChange([ActivityTypes.Running], [ActivityTypes.Running], false),
    });

    expect(setValueSpy).toHaveBeenCalledTimes(1);
    expect(setValueSpy).toHaveBeenCalledWith(expect.any(Array), { emitEvent: false });
  });

  it('clears stale selected models when selected activity inputs become empty', () => {
    const component = createComponent();

    component.selectedActivityTypes = [ActivityTypes.Running];
    component.ngOnChanges({
      selectedActivityTypes: new SimpleChange(undefined, [ActivityTypes.Running], true),
    });

    component.selectedActivityTypes = [];
    component.ngOnChanges({
      selectedActivityTypes: new SimpleChange([ActivityTypes.Running], [], false),
    });

    expect(component.selectedActivityTypesSelectionModel).toEqual([]);
    expect(component.activityTypesSelectionModelList.some(model => model.selected)).toBe(false);
  });

  it('clears local selected models immediately when the clear action is used', () => {
    const component = createComponent();
    const emittedValues: ActivityTypes[][] = [];
    component.selectedActivityTypesChange.subscribe(value => emittedValues.push(value));

    component.selectedActivityTypes = [ActivityTypes.Running];
    component.ngOnChanges({
      selectedActivityTypes: new SimpleChange(undefined, [ActivityTypes.Running], true),
    });

    component.clearSelection();

    expect(component.selectedActivityTypes).toEqual([]);
    expect(component.selectedActivityTypesSelectionModel).toEqual([]);
    expect(component.activityTypesSelectionModelList.some(model => model.selected)).toBe(false);
    expect(component.activityTypesControl.value).toEqual([]);
    expect(emittedValues).toEqual([[]]);
  });
  it('keeps subsets exact until an explicit family checkbox change, with one haptic owner', () => {
    const selection = vi.fn();
    const component = new ActivityTypesMultiSelectComponent({} as any, { selection } as unknown as AppHapticsService);
    component.ngOnInit();
    component.selectedActivityTypes = [ActivityTypes.Cycling];
    component.availableActivityTypes = [ActivityTypes.Cycling, ActivityTypes.MountainBiking];
    component.ngOnChanges({ selectedActivityTypes: new SimpleChange([], component.selectedActivityTypes, true) });
    expect(component.selectedActivityTypes).toEqual([ActivityTypes.Cycling]);
    expect(component.activityFamilyOptions[0].partial).toBe(true);
    expect(selection).not.toHaveBeenCalled();
    component.toggleFamily(component.activityFamilyOptions[0], true);
    expect(component.selectedActivityTypes).toEqual([ActivityTypes.Cycling, ActivityTypes.MountainBiking]);
    expect(selection).toHaveBeenCalledTimes(1);
    component.toggleFamily(component.activityFamilyOptions[0], true);
    expect(selection).toHaveBeenCalledTimes(1);
    component.disabled = true;
    component.clearSelection();
    component.toggleFamily(component.activityFamilyOptions[0], false);
    expect(selection).toHaveBeenCalledTimes(1);
  });

  it('offers no family shortcut for an empty available context while retaining selected individual types', () => {
    const component = createComponent();
    component.availableActivityTypes = [];
    component.selectedActivityTypes = [ActivityTypes.Running];
    component.ngOnChanges({ selectedActivityTypes: new SimpleChange([], component.selectedActivityTypes, true), availableActivityTypes: new SimpleChange(null, [], true) });
    expect(component.activityFamilyOptions).toEqual([]);
    expect(component.filter('').map(model => model.activityType)).toEqual([ActivityTypes.Running]);
  });

  it('hydrates and removes an exact catalog bridge without silently expanding its family', () => {
    const selection = vi.fn();
    const component = new ActivityTypesMultiSelectComponent({} as any, { selection } as unknown as AppHapticsService);
    component.ngOnInit();
    let visibleTypes: string[] = [];
    const subscription = component.filteredActivityTypes.subscribe(models => {
      visibleTypes = models.map(model => model.activityType);
    });
    const emit = vi.spyOn(component.selectedActivityTypesChange, 'emit');
    const savedType = CompatibleTrainingActivityTypes.RoadRunning;
    component.selectedActivityTypes = [savedType];
    component.availableActivityTypes = [];
    component.ngOnChanges({ selectedActivityTypes: new SimpleChange([], [savedType], true) });

    expect(component.selectedActivityTypes).toEqual([savedType]);
    expect(visibleTypes).toEqual([savedType]);
    expect(component.displayFn(component.selectedActivityTypesSelectionModel)).toBe(savedType);
    expect(component.activityFamilyOptions).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();

    component.ngOnChanges({ selectedActivityTypes: new SimpleChange([savedType], [savedType], false) });
    expect(emit).not.toHaveBeenCalled();
    const savedModel = component.selectedActivityTypesSelectionModel[0];
    component.toggleSelection(savedModel);
    expect(component.selectedActivityTypes).toEqual([]);
    expect(visibleTypes).toEqual([]);
    expect(emit).toHaveBeenCalledExactlyOnceWith([]);
    expect(selection).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });

  it('renders Material family checkboxes and updates exact choices through their semantic change event', async () => {
    const selection = vi.fn();
    await TestBed.configureTestingModule({
      declarations: [ActivityTypesMultiSelectComponent],
      imports: [ReactiveFormsModule, MatAutocompleteModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatIconModule, MatButtonModule],
      providers: [{ provide: AppUserService, useValue: {} }, { provide: AppHapticsService, useValue: { selection } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ActivityTypesMultiSelectComponent);
    fixture.componentRef.setInput('selectedActivityTypes', [ActivityTypes.Running]);
    fixture.componentRef.setInput('availableActivityTypes', [ActivityTypes.Running, ActivityTypes.Treadmill]);
    fixture.detectChanges();
    const checkbox = fixture.debugElement.query(By.directive(MatCheckbox));
    expect(checkbox.componentInstance.indeterminate).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="group"]').getAttribute('aria-label')).toBe('Activity families');
    checkbox.triggerEventHandler('change', { checked: true });
    fixture.detectChanges();
    expect(checkbox.componentInstance.checked).toBe(true);
    expect(checkbox.componentInstance.indeterminate).toBe(false);
    expect(fixture.componentInstance.selectedActivityTypes).toEqual([ActivityTypes.Running, ActivityTypes.Treadmill]);
    expect(selection).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

});
