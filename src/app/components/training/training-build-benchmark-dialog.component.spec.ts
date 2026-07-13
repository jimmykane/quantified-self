import { describe, expect, it, vi } from 'vitest';
import { TrainingBuildBenchmarkDialogComponent } from './training-build-benchmark-dialog.component';

function createDialog(data: any) {
  const dialogRef = { close: vi.fn() } as any;
  const functionsService = { call: vi.fn().mockResolvedValue({ data: { accepted: true } }) } as any;
  const component = new TrainingBuildBenchmarkDialogComponent(data, dialogRef, functionsService);
  return { component, dialogRef, functionsService };
}

describe('TrainingBuildBenchmarkDialogComponent', () => {
  it('saves an exact tagged race selection with the chosen duration', async () => {
    const { component, dialogRef, functionsService } = createDialog({
      discipline: 'running',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: null,
      suggestedRaces: [{ eventId: 'race-1', startDayMs: Date.UTC(2025, 8, 12), label: 'Autumn marathon' }],
    });

    component.selectDurationWeeks(10);
    component.selectRace('race-1');
    await component.save();

    expect(functionsService.call).toHaveBeenCalledWith('setTrainingBuildBenchmark', {
      discipline: 'running',
      selection: { mode: 'race', durationWeeks: 10, raceEventId: 'race-1' },
    });
    expect(dialogRef.close).toHaveBeenCalledWith({
      saved: true,
      selection: { mode: 'race', durationWeeks: 10, raceEventId: 'race-1' },
    });
  });

  it('does not report success when the derived update was not accepted', async () => {
    const { component, dialogRef, functionsService } = createDialog({
      discipline: 'running',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: null,
      suggestedRaces: [{ eventId: 'race-1', startDayMs: Date.UTC(2025, 8, 12), label: 'Autumn marathon' }],
    });
    functionsService.call.mockResolvedValueOnce({ data: { accepted: false } });

    await component.save();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.errorMessage).toContain('benchmark was saved');
  });

  it('saves a manual period and keeps invalid dates out of the callable', async () => {
    const { component, functionsService } = createDialog({
      discipline: 'cycling',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: null,
      suggestedRaces: [],
    });

    component.selectMode('period');
    component.updatePeriodEndDate('invalid');
    await component.save();
    expect(functionsService.call).not.toHaveBeenCalled();
    expect(component.errorMessage).toContain('Choose the final day');

    component.updatePeriodEndDate('2025-06-15');
    await component.save();
    expect(functionsService.call).toHaveBeenCalledWith('setTrainingBuildBenchmark', {
      discipline: 'cycling',
      selection: { mode: 'period', durationWeeks: 12, endDayMs: Date.UTC(2025, 5, 15) },
    });
  });

  it('clears only this sport benchmark', async () => {
    const { component, functionsService } = createDialog({
      discipline: 'cycling',
      selection: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2025, 5, 15) },
      suggestedRaces: [],
    });

    await component.clear();
    expect(functionsService.call).toHaveBeenCalledWith('setTrainingBuildBenchmark', {
      discipline: 'cycling',
      selection: null,
    });
  });

  it('reselects a race that remains eligible when switching from a manual period', () => {
    const { component } = createDialog({
      discipline: 'running',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2025, 8, 1) },
      suggestedRaces: [
        { eventId: 'valid-for-8-only', startDayMs: Date.UTC(2025, 10, 1), label: 'November race' },
        { eventId: 'valid-for-12', startDayMs: Date.UTC(2025, 9, 1), label: 'October race' },
      ],
    });

    component.selectDurationWeeks(12);
    component.selectMode('race');

    expect(component.raceEventId).toBe('valid-for-12');
    expect(component.visibleSuggestedRaces.map(race => race.eventId)).toEqual(['valid-for-12']);
  });
});
