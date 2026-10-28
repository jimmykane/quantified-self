import { describe, expect, it, vi } from 'vitest';
import { TrainingBuildBenchmarkDialogComponent } from './training-build-benchmark-dialog.component';
import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ApplicationRef } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormField, MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { AppFunctionsService } from '../../services/app.functions.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { HapticTapDirective } from '../../directives/haptic-tap.directive';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

function createDialog(data: any) {
  const dialogRef = { close: vi.fn() } as any;
  const functionsService = { call: vi.fn().mockResolvedValue({ data: { accepted: true } }) } as any;
  const snackBar = { open: vi.fn() } as any;
  const changeDetector = { markForCheck: vi.fn() } as any;
  const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() } as any;
  const component = new TrainingBuildBenchmarkDialogComponent(
    data,
    dialogRef,
    functionsService,
    snackBar,
    changeDetector,
    haptics,
  );
  return { component, dialogRef, functionsService, snackBar, changeDetector, haptics };
}

describe('TrainingBuildBenchmarkDialogComponent', () => {
  it('saves an exact event selection with the chosen duration', async () => {
    const { component, dialogRef, functionsService, haptics } = createDialog({
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
    expect(haptics.success).toHaveBeenCalledTimes(1);
    expect(haptics.error).not.toHaveBeenCalled();
  });

  it('does not report success when the derived update was not accepted', async () => {
    const { component, dialogRef, functionsService, snackBar, haptics } = createDialog({
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
    expect(snackBar.open).toHaveBeenCalledWith(
      'The benchmark was saved, but the comparison could not be queued. Try again.',
      'Dismiss',
      { duration: 6000, politeness: 'assertive' },
    );
    expect(haptics.error).toHaveBeenCalledTimes(1);
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('shows App Check failures immediately without exposing raw SDK details', async () => {
    const { component, dialogRef, functionsService, snackBar } = createDialog({
      discipline: 'running',
      asOfDayMs: Date.UTC(2026, 0, 1),
      selection: null,
      suggestedRaces: [{ eventId: 'race-1', startDayMs: Date.UTC(2025, 8, 12), label: 'Autumn marathon' }],
    });
    functionsService.call.mockRejectedValueOnce({
      code: 'appCheck/fetch-status-error',
      message: 'AppCheck: Fetch server returned an HTTP error status. HTTP status: 403.',
    });

    component.selectEvent('race-1');
    await component.save();

    const message = 'Could not verify your secure session. Refresh the app and try again.';
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.errorMessage).toBe(message);
    expect(snackBar.open).toHaveBeenCalledWith(message, 'Dismiss', {
      duration: 6000,
      politeness: 'assertive',
    });
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

  it('derives new sport-family labels from the shared registry', () => {
    const { component } = createDialog({
      discipline: 'rowing',
      asOfDayMs: Date.UTC(2026, 3, 1),
      selection: null,
      suggestedRaces: [],
      suggestedEvents: [],
    });

    expect(component.disciplineLabel).toBe('rowing');
  });

  it('clears only this sport benchmark', async () => {
    const { component, functionsService, haptics } = createDialog({
      discipline: 'cycling',
      selection: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2025, 5, 15) },
      suggestedRaces: [],
    });

    await component.clear();
    expect(functionsService.call).toHaveBeenCalledWith('setTrainingBuildBenchmark', {
      discipline: 'cycling',
      selection: null,
    });
    expect(haptics.success).toHaveBeenCalledTimes(1);
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

  it('only acknowledges accepted user changes, not hydration, typing or no-op selections', () => {
    const { component, haptics } = createDialog({
      discipline: 'cycling', asOfDayMs: Date.UTC(2026, 9, 11), selection: null, suggestedRaces: [],
    });
    component.updateEventSuggestions({
      asOfDayMs: Date.UTC(2026, 9, 11), state: 'ready', suggestedRaces: [],
      suggestedEvents: [{ eventId: 'ride-1', startDayMs: Date.UTC(2025, 5, 15), label: 'Mountain ride' }],
    });
    component.selectMode('event');
    component.selectDurationWeeks(12);
    component.selectEventDateFilter('all');
    component.selectEventSort('latest');
    component.selectEventOption(undefined);
    component.updatePeriodEndDate('2025-06-15');
    expect(haptics.selection).not.toHaveBeenCalled();

    component.selectEvent('ride-1');
    component.selectEvent('ride-1');
    component.selectDurationWeeks(8);
    component.selectMode('period');
    component.selectEventDateFilter('earlier');
    component.selectEventSort('longest');
    component.toggleRaceList();
    expect(haptics.selection).toHaveBeenCalledTimes(6);
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
  });

  it('blocks duplicate saves and changes while pending, with feedback only after the outcome', async () => {
    const { component, functionsService, haptics } = createDialog({
      discipline: 'cycling', asOfDayMs: Date.UTC(2026, 9, 11),
      selection: { mode: 'period', durationWeeks: 8, endDayMs: Date.UTC(2025, 5, 15) }, suggestedRaces: [],
    });
    let resolveSave!: (result: { data: { accepted: boolean } }) => void;
    functionsService.call.mockReturnValue(new Promise(resolve => { resolveSave = resolve; }));
    const pending = component.save();
    expect(component.isSaving).toBe(true);
    component.selectMode('event');
    component.selectDurationWeeks(12);
    component.selectEvent('another-event');
    component.selectEventDateFilter('recent');
    component.selectEventSort('highest-load');
    component.toggleRaceList();
    component.updatePeriodEndDate('2025-07-01');
    await component.save();
    await component.clear();
    expect(functionsService.call).toHaveBeenCalledTimes(1);
    expect(component.mode).toBe('period');
    expect(component.durationWeeks).toBe(8);
    expect(component.eventId).toBeNull();
    expect(component.eventDateFilter).toBe('all');
    expect(component.eventSort).toBe('latest');
    expect(component.isRaceListExpanded).toBe(false);
    expect(component.periodEndDate).toBe('2025-06-15');
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
    resolveSave({ data: { accepted: true } });
    await pending;
    expect(component.isSaving).toBe(false);
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });
});

describe('Training benchmark dialog presentation', () => {
  async function renderDialog(suggestedRaces: any[] = []) {
    const functionsService = { call: vi.fn() };
    const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    const dialogRef = { close: vi.fn() };
    await TestBed.configureTestingModule({
      declarations: [TrainingBuildBenchmarkDialogComponent, HapticTapDirective],
      imports: [
        CommonModule, MatDialogModule, MatButtonModule, MatButtonToggleModule,
        MatFormFieldModule, MatInputModule, MatListModule, MatProgressSpinnerModule,
        MatSelectModule, NoopAnimationsModule,
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: {
          discipline: 'cycling', asOfDayMs: Date.UTC(2026, 9, 11), selection: null,
          suggestedRaces,
          suggestedEvents: [{ eventId: 'ride-1', startDayMs: Date.UTC(2025, 5, 15), label: 'Long mountain ride', durationSeconds: 7200 }],
        } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: AppFunctionsService, useValue: functionsService },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: AppHapticsService, useValue: haptics },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TrainingBuildBenchmarkDialogComponent);
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement, functionsService, haptics, dialogRef };
  }

  it('uses flat labelled sections and native two-line Material event rows', async () => {
    const { fixture, element, functionsService, haptics } = await renderDialog([
      { eventId: 'race-1', startDayMs: Date.UTC(2025, 4, 24), label: 'Mountain race', durationSeconds: 10800 },
    ]);

    expect(element.querySelector('mat-card')).toBeNull();
    expect(element.querySelectorAll('section.event-picker-section')).toHaveLength(2);
    expect(element.querySelector('[matListItemTitle]')?.textContent).toContain('Mountain race');
    expect(element.querySelector('[matListItemLine]')?.textContent).toContain('2025');
    expect(haptics.selection).not.toHaveBeenCalled();

    (element.querySelector('.event-option-list-scroll mat-list-option') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.eventId).toBe('ride-1');
    expect(element.querySelector('.event-option-selected')).not.toBeNull();
    expect(element.querySelector('.event-selection-preview')?.textContent).toContain('Long mountain ride');
    expect(functionsService.call).not.toHaveBeenCalled();
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('keeps the single event section and manual-date flow usable without race cards', async () => {
    const { fixture, element, functionsService, haptics, dialogRef } = await renderDialog();
    expect(element.querySelectorAll('section.event-picker-section')).toHaveLength(1);
    (element.querySelector('mat-button-toggle[value="period"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(element.querySelector('.event-picker')).toBeNull();
    expect(element.querySelector('input[type="date"]')).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(MatFormField)).componentInstance.subscriptSizing).toBe('dynamic');
    expect(element.querySelector('.dialog-primary-action')?.textContent).toContain('Save benchmark');
    expect(functionsService.call).not.toHaveBeenCalled();
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    (element.querySelector('.dialog-cancel-action') as HTMLButtonElement).click();
    expect(dialogRef.close).toHaveBeenCalledTimes(1);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('retains race disclosure and disabled overlapping events in the flat list', async () => {
    const { fixture, element, haptics } = await renderDialog([
      { eventId: 'recent', startDayMs: Date.UTC(2026, 9, 1), label: 'Recent race' },
      ...[1, 2, 3].map(day => ({ eventId: `race-${day}`, startDayMs: Date.UTC(2025, 5, day), label: `Race ${day}` })),
    ]);
    const disabled = element.querySelector('mat-list-option[aria-disabled="true"]') as HTMLElement;
    expect(disabled.textContent).toContain('Not available for this build length');
    disabled.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.eventId).toBeNull();
    expect(haptics.selection).not.toHaveBeenCalled();
    const disclosure = element.querySelector('[aria-controls="benchmark-races-list"]') as HTMLButtonElement;
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(element.querySelectorAll('#benchmark-races-list mat-list-option')).toHaveLength(3);
    disclosure.click();
    fixture.detectChanges();
    const collapse = element.querySelector('[aria-controls="benchmark-races-list"]') as HTMLButtonElement;
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(collapse.textContent).toContain('Show less');
    expect(element.querySelectorAll('#benchmark-races-list mat-list-option')).toHaveLength(4);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('renders the standard dialog shell across event, date and pending states', async () => {
    const races = [
      { eventId: 'race-1', startDayMs: Date.UTC(2026, 4, 24), label: 'Mountain revival — endurance race', distanceMeters: 27330, durationSeconds: 15600 },
      { eventId: 'race-2', startDayMs: Date.UTC(2026, 3, 26), label: 'Volcano enduro — mountain stage 2', distanceMeters: 21740, durationSeconds: 11400 },
      { eventId: 'race-3', startDayMs: Date.UTC(2026, 3, 25), label: 'Volcano enduro — mountain stage 1', distanceMeters: 19070, durationSeconds: 9000 },
      { eventId: 'race-4', startDayMs: Date.UTC(2026, 9, 1), label: 'Recent race' },
    ];
    const { fixture, functionsService } = await renderDialog(races);
    const ref = TestBed.inject(MatDialog).open(TrainingBuildBenchmarkDialogComponent, {
      width: '720px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)',
      data: {
        ...fixture.componentInstance.data,
        selection: { mode: 'event', durationWeeks: 8, eventId: 'race-1' },
        suggestedEvents: Array.from({ length: 12 }, (_, index) => ({
          eventId: `ride-${index}`, startDayMs: Date.UTC(2026, 5, index + 1),
          label: `Long mountain ride ${index + 1}`, distanceMeters: 50000, durationSeconds: 10800, trainingStressScore: 140,
        })),
      },
    });
    await TestBed.inject(ApplicationRef).whenStable();
    const qaDir = process.env.TRAINING_BENCHMARK_QA_DIR;
    const qaCss = qaDir ? (() => {
      const sass = createRequire(createRequire(import.meta.url).resolve('@angular/build/package.json'))('sass');
      const source = readFileSync('src/app/components/training/training-build-benchmark-dialog.component.scss', 'utf8');
      // Match emulated component encapsulation's extra attribute specificity so
      // Material's global classes do not incorrectly win only in the static artifact.
      return sass.compileString(`@use '@angular/material' as mat; [data-benchmark-qa] { ${source.replace("@use '@angular/material' as mat;", '').replace(/:host/g, '&')} }`, { loadPaths: ['node_modules'] }).css;
    })() : '';
    const render = (name: string) => {
      ref.componentRef!.changeDetectorRef.markForCheck();
      TestBed.inject(ApplicationRef).tick();
      ref.componentRef!.changeDetectorRef.detectChanges();
      if (!qaDir) { return; }
      const body = document.body.cloneNode(true) as HTMLElement;
      body.replaceChildren(document.querySelector('.cdk-overlay-container')!.cloneNode(true));
      body.querySelector('app-training-build-benchmark-dialog')!.setAttribute('data-benchmark-qa', '');
      body.classList.add('app-hydrated');
      if (name.endsWith('-dark')) { body.classList.add('dark-theme'); }
      document.querySelectorAll('[role="dialog"] input').forEach((input: HTMLInputElement, index) => body.querySelectorAll('input')[index].setAttribute('value', input.value));
      writeFileSync(join(qaDir, `${name}.html`), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Benchmark dialog QA · Synthetic events</title><link rel="stylesheet" href="styles.css">${Array.from(document.head.querySelectorAll('style')).map(style => style.outerHTML).join('')}<style>${qaCss}</style></head>${body.outerHTML}</html>`);
    };
    render('benchmark-events');
    render('benchmark-events-dark');
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toContain('Set cycling benchmark');
    expect(document.querySelector('[role="dialog"] mat-card')).toBeNull();
    (document.querySelector('[role="dialog"] [aria-controls="benchmark-races-list"]') as HTMLButtonElement).click();
    render('benchmark-expanded');
    (document.querySelector('[role="dialog"] mat-button-toggle[value="period"] button') as HTMLButtonElement).click();
    render('benchmark-dates');
    expect(document.querySelector('[role="dialog"] input[type="date"]')).not.toBeNull();
    functionsService.call.mockReturnValue(new Promise(() => {}));
    (document.querySelector('[role="dialog"] .dialog-primary-action') as HTMLButtonElement).click();
    render('benchmark-pending');
    expect(document.querySelector('[role="dialog"] .dialog-primary-action')?.hasAttribute('disabled')).toBe(true);
    expect(functionsService.call).toHaveBeenCalledTimes(1);
    ref.close();
  });
});
