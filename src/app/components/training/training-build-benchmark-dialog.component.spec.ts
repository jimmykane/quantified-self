import { describe, expect, it, vi } from 'vitest';
import { TrainingBuildBenchmarkDialogComponent } from './training-build-benchmark-dialog.component';

function createDialog(data: any) {
  const dialogRef = { close: vi.fn() } as any;
  const functionsService = { call: vi.fn().mockResolvedValue({ data: { accepted: true } }) } as any;
  const changeDetector = { markForCheck: vi.fn() } as any;
  const component = new TrainingBuildBenchmarkDialogComponent(data, dialogRef, functionsService, changeDetector);
  return { component, dialogRef, functionsService, changeDetector };
}

describe('TrainingBuildBenchmarkDialogComponent', () => {
  it('saves an exact event selection with the chosen duration', async () => {
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
      selection: { mode: 'event', durationWeeks: 10, eventId: 'race-1' },
    });
    expect(dialogRef.close).toHaveBeenCalledWith({
      saved: true,
      selection: { mode: 'event', durationWeeks: 10, eventId: 'race-1' },
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

    component.selectEvent('race-1');
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
    expect(component.canSave).toBe(false);
    await component.save();
    expect(functionsService.call).not.toHaveBeenCalled();
    expect(component.errorMessage).toContain('Choose the final day');

    component.updatePeriodEndDate('2025-12-31');
    expect(component.canSave).toBe(false);
    expect(component.errorMessage).toContain('must end before');
    await component.save();
    expect(functionsService.call).not.toHaveBeenCalled();
    expect(component.errorMessage).toContain('must end before');

    component.updatePeriodEndDate('2025-06-15');
    expect(component.canSave).toBe(true);
    await component.save();
    expect(functionsService.call).toHaveBeenCalledWith('setTrainingBuildBenchmark', {
      discipline: 'cycling',
      selection: { mode: 'period', durationWeeks: 12, endDayMs: Date.UTC(2025, 5, 15) },
    });
  });

  it('keeps the suggested manual period adjacent to the current build when duration changes', () => {
    const asOfDayMs = Date.UTC(2026, 0, 1);
    const { component } = createDialog({
      discipline: 'cycling',
      asOfDayMs,
      selection: null,
      suggestedRaces: [],
    });

    expect(component.periodEndDate).toBe('2025-10-09');

    component.selectDurationWeeks(8);
    component.selectMode('period');

    expect(component.periodEndDate).toBe('2025-11-06');
    expect(component.canSave).toBe(true);
  });

  it('uses swim-distance presentation for Swimming event choices', () => {
    const { component } = createDialog({
      discipline: 'swimming',
      asOfDayMs: Date.UTC(2026, 3, 1),
      selection: null,
      suggestedRaces: [],
      suggestedEvents: [{
        eventId: 'swim-1', startDayMs: Date.UTC(2025, 10, 1), label: 'Pool test',
        distanceMeters: 1_500, durationSeconds: 1_800, trainingStressScore: null,
      }],
    });

    expect(component.disciplineLabel).toBe('swimming');
    expect(component.visibleSuggestedEvents[0].detailsText).toContain('m');
    expect(component.visibleSuggestedEvents[0].detailsText).not.toContain('km');
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

  it('requires an explicit event choice when switching from a manual period', () => {
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

    expect(component.eventId).toBeNull();
    expect(component.selectedEvent).toBeNull();
    expect(component.canSave).toBe(false);
    expect(component.visibleSuggestedRaces).toEqual([
      expect.objectContaining({ eventId: 'valid-for-8-only', isEligible: false }),
      expect.objectContaining({ eventId: 'valid-for-12', isEligible: true }),
    ]);
  });

  it('handles Material selection-list values defensively', () => {
    const { component } = createDialog({
      discipline: 'running',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: null,
      suggestedRaces: [{ eventId: 'race-1', startDayMs: Date.UTC(2025, 8, 12), label: 'Autumn marathon' }],
    });

    component.selectEventOption(undefined);
    expect(component.eventId).toBeNull();

    component.selectEventOption(' race-1 ');
    expect(component.eventId).toBe('race-1');
    expect(component.selectedEvent?.eventId).toBe('race-1');
  });

  it('uses a selected untagged historical event without changing its tags', async () => {
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
      selection: { mode: 'event', durationWeeks: 12, eventId: 'event-1' },
    });
    expect(component.saveActionLabel).toBe('Use event');
    expect(dialogRef.close).toHaveBeenCalledWith({
      saved: true,
      selection: { mode: 'event', durationWeeks: 12, eventId: 'event-1' },
    });
  });

  it('orders recognizable activity summaries without relying on generic event names', () => {
    const { component } = createDialog({
      discipline: 'cycling',
      asOfDayMs: Date.UTC(2026, 3, 1),
      selection: null,
      suggestedRaces: [{
        eventId: 'race-1', startDayMs: Date.UTC(2025, 7, 12), label: 'Gran fondo',
        distanceMeters: 160_000, durationSeconds: 18_000, trainingStressScore: 400,
      }],
      suggestedEvents: [
        {
          eventId: 'event-1', startDayMs: Date.UTC(2025, 10, 1), label: 'New event',
          distanceMeters: 40_000, durationSeconds: 5_400, trainingStressScore: 110,
        },
        {
          eventId: 'event-2', startDayMs: Date.UTC(2024, 4, 1), label: 'Mountain day',
          distanceMeters: 90_000, durationSeconds: 14_400, trainingStressScore: null,
        },
        {
          eventId: 'event-3', startDayMs: Date.UTC(2025, 9, 1), label: 'Threshold session',
          distanceMeters: 30_000, durationSeconds: 4_800, trainingStressScore: 180,
        },
      ],
    });

    expect(component.visibleSuggestedRaces.map(event => event.eventId)).toEqual(['race-1']);
    expect(component.visibleSuggestedEvents.map(event => event.eventId)).toEqual(['event-1', 'event-3', 'event-2']);
    expect(component.visibleSuggestedEvents[0].displayLabel).toBeNull();
    expect(component.visibleSuggestedEvents[0].detailsText).toContain('110 TSS');

    component.selectEventSort('longest');
    expect(component.visibleSuggestedEvents.map(event => event.eventId)).toEqual(['event-2', 'event-1', 'event-3']);

    component.selectEventSort('highest-load');
    expect(component.visibleSuggestedEvents.map(event => event.eventId)).toEqual(['event-3', 'event-1', 'event-2']);

    component.selectEventDateFilter('earlier');
    expect(component.visibleSuggestedEvents.map(event => event.eventId)).toEqual(['event-2']);
  });

  it('keeps overlapping and factless generic events out of the event picker', () => {
    const { component } = createDialog({
      discipline: 'running',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: null,
      suggestedRaces: [],
      suggestedEvents: [
        {
          eventId: 'overlapping', startDayMs: Date.UTC(2025, 10, 1), label: 'New event',
          distanceMeters: 15_000, durationSeconds: 5_400, trainingStressScore: 100,
        },
        {
          eventId: 'factless', startDayMs: Date.UTC(2025, 8, 15), label: 'New event',
          distanceMeters: 0.01, durationSeconds: 30, trainingStressScore: 0.4,
        },
        {
          eventId: 'eligible', startDayMs: Date.UTC(2025, 8, 1), label: 'New event',
          distanceMeters: 20_000, durationSeconds: 7_200, trainingStressScore: 120,
        },
      ],
    });

    expect(component.visibleSuggestedEvents.map(event => event.eventId)).toEqual(['eligible']);
    expect(component.hiddenOverlappingEventCount).toBe(1);
    expect(component.eventEligibilityCutoffDayMs).toBe(Date.UTC(2025, 9, 10));
  });

  it('replaces loading suggestions when the derived snapshot arrives while the dialog is open', () => {
    const { component, changeDetector } = createDialog({
      discipline: 'cycling',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: null,
      suggestedRaces: [],
      suggestedEvents: [],
      eventSuggestionsState: 'loading',
    });

    component.updateEventSuggestions({
      asOfDayMs: Date.UTC(2026, 0, 2),
      suggestedRaces: [],
      suggestedEvents: [{
        eventId: 'event-1',
        startDayMs: Date.UTC(2025, 7, 20),
        label: 'New event',
        distanceMeters: 80_000,
        durationSeconds: 10_800,
        trainingStressScore: 220,
      }],
      state: 'ready',
    });

    expect(component.eventSuggestionsState).toBe('ready');
    expect(component.visibleSuggestedEvents).toEqual([
      expect.objectContaining({
        eventId: 'event-1',
        detailsText: expect.stringContaining('220 TSS'),
        displayLabel: null,
      }),
    ]);
    expect(component.eventId).toBeNull();
    expect(component.selectedEvent).toBeNull();
    expect(component.canSave).toBe(false);
    expect(changeDetector.markForCheck).toHaveBeenCalledTimes(1);
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

  it('clears a selected event when a longer duration makes it overlap the current build', () => {
    const { component } = createDialog({
      discipline: 'running',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: { mode: 'event', durationWeeks: 8, eventId: 'autumn-event' },
      suggestedRaces: [{
        eventId: 'autumn-event',
        startDayMs: Date.UTC(2025, 9, 31),
        label: 'Autumn race',
      }],
    });

    expect(component.selectedEvent?.isEligible).toBe(true);

    component.selectDurationWeeks(12);

    expect(component.eventId).toBeNull();
    expect(component.selectedEvent).toBeNull();
    expect(component.canSave).toBe(false);
    expect(component.errorMessage).toContain('overlaps your current 12-week build');
  });

  it('does not leak event validation into the manual-period flow', () => {
    const { component } = createDialog({
      discipline: 'running',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: null,
      suggestedRaces: [{
        eventId: 'autumn-event',
        startDayMs: Date.UTC(2025, 9, 31),
        label: 'Autumn race',
      }],
    });

    component.selectDurationWeeks(8);
    component.selectEvent('autumn-event');
    component.selectMode('period');
    component.selectDurationWeeks(12);

    expect(component.eventId).toBeNull();
    expect(component.canSave).toBe(true);
    expect(component.errorMessage).toBeNull();
  });
});
