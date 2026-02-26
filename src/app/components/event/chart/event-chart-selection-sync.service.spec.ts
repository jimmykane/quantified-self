import { describe, expect, it } from 'vitest';
import { EventChartSelectionSyncService } from './event-chart-selection-sync.service';

describe('EventChartSelectionSyncService', () => {
  it('normalizes reversed ranges and stores canonical values', () => {
    const service = new EventChartSelectionSyncService();

    service.setSelection({ start: 20, end: 10 });

    expect(service.selectionRange()).toEqual({ start: 10, end: 20 });
  });

  it('drops invalid values and clears selection', () => {
    const service = new EventChartSelectionSyncService();

    service.setSelection({ start: 1, end: 2 });
    service.setSelection({ start: Number.NaN, end: 2 });

    expect(service.selectionRange()).toBeNull();
  });

  it('clears selection explicitly', () => {
    const service = new EventChartSelectionSyncService();

    service.setSelection({ start: 1, end: 2 });
    service.clearSelection();

    expect(service.selectionRange()).toBeNull();
  });
});
