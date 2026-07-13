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
    component.selectEvent('race-1');
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

  it('keeps an eligible tagged race selected when switching from a manual period', () => {
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
    component.selectMode('event');

    expect(component.eventId).toBe('valid-for-12');
    expect(component.visibleSuggestedRaces).toEqual([
      expect.objectContaining({ eventId: 'valid-for-8-only', isEligible: false }),
      expect.objectContaining({ eventId: 'valid-for-12', isEligible: true }),
    ]);
  });

  it('explicitly marks a selected historical event as Race before using it', async () => {
    const { component, dialogRef, functionsService } = createDialog({
      discipline: 'running',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: null,
      suggestedRaces: [],
      suggestedEvents: [{ eventId: 'event-1', startDayMs: Date.UTC(2025, 7, 20), label: 'Long run dress rehearsal' }],
    });

    component.selectEvent('event-1');
    await component.save();

    expect(functionsService.call).toHaveBeenCalledWith('setTrainingBuildBenchmark', {
      discipline: 'running',
      selection: { mode: 'race', durationWeeks: 12, raceEventId: 'event-1' },
      markRaceEventId: 'event-1',
    });
    expect(component.saveActionLabel).toBe('Mark as Race and use event');
    expect(dialogRef.close).toHaveBeenCalledWith({
      saved: true,
      selection: { mode: 'race', durationWeeks: 12, raceEventId: 'event-1' },
    });
  });

  it('filters other events without hiding the prioritized tagged races', () => {
    const { component } = createDialog({
      discipline: 'cycling',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: null,
      suggestedRaces: [{ eventId: 'race-1', startDayMs: Date.UTC(2025, 7, 12), label: 'Gran fondo' }],
      suggestedEvents: [
        { eventId: 'event-1', startDayMs: Date.UTC(2025, 10, 1), label: 'Tempo ride' },
        { eventId: 'event-2', startDayMs: Date.UTC(2024, 4, 1), label: 'Mountain day' },
      ],
    });

    component.updateEventSearchQuery('tempo');
    expect(component.visibleSuggestedRaces.map(event => event.eventId)).toEqual(['race-1']);
    expect(component.visibleSuggestedEvents.map(event => event.eventId)).toEqual(['event-1']);

    component.updateEventSearchQuery('');
    component.selectEventDateFilter('earlier');
    expect(component.visibleSuggestedEvents.map(event => event.eventId)).toEqual(['event-2']);
  });

  it('does not allow an event that would overlap the current build', async () => {
    const { component, functionsService } = createDialog({
      discipline: 'running',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: null,
      suggestedRaces: [],
      suggestedEvents: [{ eventId: 'recent-event', startDayMs: Date.UTC(2025, 10, 15), label: 'Recent long run' }],
    });

    component.selectEvent('recent-event');
    await component.save();

    expect(component.selectedEvent?.isEligible).toBe(false);
    expect(component.errorMessage).toContain('eligible');
    expect(functionsService.call).not.toHaveBeenCalled();
  });
});
