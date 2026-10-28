import { ChangeDetectorRef } from '@angular/core';
import { DataDistance, DataHeartRateAvg, DataPowerAvg, DataPowerMax, DistanceUnits, type DataInterface } from '@sports-alliance/sports-lib';
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
  it('reads and formats only requested cells, caches them, and permits exclusion overrides', () => {
    const directive = new TestDataTableDirective({ detectChanges: vi.fn() } as any);
    const distance = new DataDistance(0);
    const format = vi.spyOn(distance, 'getDisplayValue');
    const getStat = vi.fn(type => type === DataDistance.type ? distance : undefined);
    const row = directive.getStatsRowElementFromReader({ getStat } as any, []);
    expect(getStat).not.toHaveBeenCalled();
    expect(Object.keys(row)).toContain(DataDistance.type);
    expect(getStat).not.toHaveBeenCalled();
    expect(row['sort.Distance']).toBe(0);
    expect(format).not.toHaveBeenCalled();
    expect(row.Distance).toBe('0.0 m');
    const calls = format.mock.calls.length;
    expect(row.Distance).toBe('0.0 m');
    expect(format).toHaveBeenCalledTimes(calls);
    expect(getStat.mock.calls.every(([type]) => type === DataDistance.type)).toBe(true);
    row.Ascent = '';
    expect(row.Ascent).toBe('');
  });

  it('sorts maximum power by its own value', () => {
    const directive = new TestDataTableDirective({ detectChanges: vi.fn() } as any);
    const row = directive.getStatsRowElement([new DataPowerAvg(100), new DataPowerMax(250)], []);
    expect(row[`sort.${DataPowerMax.type}`]).toBe(250);
  });

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
