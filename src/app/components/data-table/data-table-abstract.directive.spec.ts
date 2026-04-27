import { ChangeDetectorRef } from '@angular/core';
import { DataDistance, DataHeartRateAvg, DistanceUnits, type DataInterface } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
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

  it('formats distance with unit settings and keeps canonical sort value', () => {
    const changeDetectorRef = { detectChanges: vi.fn() } as unknown as ChangeDetectorRef;
    const directive = new TestDataTableDirective(changeDetectorRef);
    const distance = new DataDistance(10000);
    const unitSettings = normalizeUserUnitSettings({
      distanceUnits: DistanceUnits.Miles,
    });

    const row = directive.getStatsRowElement([distance], [], unitSettings);

    expect(row[DataDistance.type]).toBe('6.22 mi');
    expect(row[`sort.${DataDistance.type}`]).toBe(10000);
  });
});
