import { SimpleChange } from '@angular/core';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { ActivityTypesMultiSelectComponent } from './activity-types-multi-select.component';

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
});
