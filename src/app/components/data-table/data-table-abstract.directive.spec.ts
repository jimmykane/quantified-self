import { ChangeDetectorRef } from '@angular/core';
import { DataHeartRateAvg, type DataInterface } from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { DataTableAbstractDirective } from './data-table-abstract.directive';

class TestDataTableDirective extends DataTableAbstractDirective {
  override getColumnsToDisplay(): string[] {
    return [];
  }

  override isSticky(): boolean {
    return false;
  }

  override isStickyEnd(): boolean {
    return false;
  }
}

const createStat = (
  type: string,
  value: number,
  displayValue: string,
  displayUnit: string,
): DataInterface =>
  ({
    getType: () => type,
    getValue: () => value,
    getDisplayValue: () => displayValue,
    getDisplayUnit: () => displayUnit,
  }) as unknown as DataInterface;

describe('DataTableAbstractDirective', () => {
  it('sets sort value for Average Heart Rate', () => {
    const changeDetectorRef = { detectChanges: vi.fn() } as unknown as ChangeDetectorRef;
    const directive = new TestDataTableDirective(changeDetectorRef);
    const heartRate = createStat(DataHeartRateAvg.type, 152, '152', 'bpm');

    const row = directive.getStatsRowElement([heartRate], []);

    expect(row[DataHeartRateAvg.type]).toBe('152 bpm');
    expect(row[`sort.${DataHeartRateAvg.type}`]).toBe(152);
  });
});
