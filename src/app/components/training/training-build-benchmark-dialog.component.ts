import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DataDistance, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type {
  DerivedTrainingBuildEventSuggestion,
  DerivedTrainingBuildRaceSuggestion,
  DerivedTrainingDiscipline,
  SetTrainingBuildBenchmarkRequest,
  SetTrainingBuildBenchmarkResponse,
  TrainingBuildBenchmarkSelection,
  TrainingBuildDurationWeeks,
} from '@shared/derived-metrics';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import { formatSleepDuration } from '../../helpers/dashboard-sleep-chart.helper';
import { AppFunctionsService } from '../../services/app.functions.service';

type TrainingBuildReferenceMode = 'event' | 'period';
type TrainingBuildEventDateFilter = 'all' | 'recent' | 'earlier';
type TrainingBuildEventSort = 'latest' | 'longest' | 'highest-load';
export type TrainingBuildEventSuggestionsState = 'ready' | 'loading' | 'unavailable';

interface TrainingBuildEventOption extends DerivedTrainingBuildEventSuggestion {
  isEligible: boolean;
  detailsText: string;
  displayLabel: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TAGGED_RACES_COLLAPSED_LIMIT = 3;

export interface TrainingBuildBenchmarkDialogData {
  discipline: DerivedTrainingDiscipline;
  asOfDayMs: number;
  suggestedRaces: DerivedTrainingBuildRaceSuggestion[];
  suggestedEvents?: DerivedTrainingBuildEventSuggestion[];
  eventSuggestionsState?: TrainingBuildEventSuggestionsState;
  selection: TrainingBuildBenchmarkSelection | null;
  unitSettings?: UserUnitSettingsInterface | null;
}

export interface TrainingBuildEventSuggestionsUpdate {
  asOfDayMs: number;
  suggestedRaces: DerivedTrainingBuildRaceSuggestion[];
  suggestedEvents: DerivedTrainingBuildEventSuggestion[];
  state: TrainingBuildEventSuggestionsState;
}

@Component({
  selector: 'app-training-build-benchmark-dialog',
  templateUrl: './training-build-benchmark-dialog.component.html',
  styleUrls: ['./training-build-benchmark-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TrainingBuildBenchmarkDialogComponent {
  public mode: TrainingBuildReferenceMode;
  public durationWeeks: TrainingBuildDurationWeeks;
  public eventId: string | null;
  public periodEndDate: string;
  public isSaving = false;
  public errorMessage: string | null = null;
  public visibleSuggestedRaces: TrainingBuildEventOption[] = [];
  public displayedSuggestedRaces: TrainingBuildEventOption[] = [];
  public visibleSuggestedEvents: TrainingBuildEventOption[] = [];
  public eventSuggestionsState: TrainingBuildEventSuggestionsState;
  public eventDateFilter: TrainingBuildEventDateFilter = 'all';
  public eventSort: TrainingBuildEventSort = 'latest';
  public isRaceListExpanded = false;
  public selectedEvent: TrainingBuildEventOption | null = null;
  public selectedBuildStartDayMs: number | null = null;
  public selectedBenchmarkEndDayMs: number | null = null;
  public selectedEventNeedsRaceTag = false;
  public saveActionLabel = 'Save benchmark';
  public canSave = true;

  constructor(
    @Inject(MAT_DIALOG_DATA) public readonly data: TrainingBuildBenchmarkDialogData,
    private readonly dialogRef: MatDialogRef<TrainingBuildBenchmarkDialogComponent>,
    private readonly functionsService: AppFunctionsService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {
    const selection = data.selection;
    this.durationWeeks = selection?.durationWeeks || 12;
    this.mode = selection?.mode === 'period' ? 'period' : 'event';
    this.eventId = selection?.mode === 'race' ? selection.raceEventId : null;
    this.eventSuggestionsState = data.eventSuggestionsState || 'ready';
    this.periodEndDate = selection?.mode === 'period'
      ? this.formatDateInput(selection.endDayMs)
      : this.formatDateInput(this.defaultPeriodEndDayMs());
    this.refreshEventOptions();
    if (this.mode === 'event' && !this.selectedEvent) {
      this.eventId = this.visibleSuggestedRaces.find(event => event.isEligible)?.eventId
        || this.visibleSuggestedEvents.find(event => event.isEligible)?.eventId
        || null;
      this.refreshSelectedEvent();
    }
  }

  public selectMode(mode: TrainingBuildReferenceMode): void {
    this.mode = mode;
    if (mode === 'event' && !this.selectedEvent) {
      this.eventId = this.visibleSuggestedRaces.find(event => event.isEligible)?.eventId
        || this.visibleSuggestedEvents.find(event => event.isEligible)?.eventId
        || null;
      this.refreshSelectedEvent();
    }
    this.refreshSaveActionLabel();
    this.errorMessage = null;
  }

  public updateEventSuggestions(update: TrainingBuildEventSuggestionsUpdate): void {
    this.data.asOfDayMs = update.asOfDayMs;
    this.data.suggestedRaces = update.suggestedRaces;
    this.data.suggestedEvents = update.suggestedEvents;
    this.eventSuggestionsState = update.state;
    this.refreshEventOptions();
    if (this.mode === 'event' && !this.selectedEvent) {
      this.eventId = this.visibleSuggestedRaces.find(event => event.isEligible)?.eventId
        || this.visibleSuggestedEvents.find(event => event.isEligible)?.eventId
        || null;
      this.refreshSelectedEvent();
    }
    this.changeDetector.markForCheck();
  }

  public selectDurationWeeks(durationWeeks: TrainingBuildDurationWeeks): void {
    this.durationWeeks = durationWeeks;
    this.refreshEventOptions();
    this.errorMessage = null;
  }

  public selectEvent(eventId: string): void {
    this.eventId = eventId;
    this.refreshSelectedEvent();
    this.errorMessage = null;
  }

  public selectEventDateFilter(value: TrainingBuildEventDateFilter): void {
    this.eventDateFilter = value;
    this.refreshEventOptions();
  }

  public selectEventSort(value: TrainingBuildEventSort): void {
    this.eventSort = value;
    this.refreshEventOptions();
  }

  public toggleRaceList(): void {
    this.isRaceListExpanded = !this.isRaceListExpanded;
    this.refreshDisplayedSuggestedRaces();
  }

  public updatePeriodEndDate(value: string): void {
    this.periodEndDate = value;
    this.errorMessage = null;
  }

  public async save(): Promise<void> {
    const selection = this.buildSelection();
    if (!selection) {
      return;
    }
    await this.persist(selection);
  }

  public async clear(): Promise<void> {
    await this.persist(null);
  }

  private buildSelection(): TrainingBuildBenchmarkSelection | null {
    if (this.mode === 'event') {
      if (!this.selectedEvent || !this.selectedEvent.isEligible) {
        this.errorMessage = 'Choose an eligible tagged race or historical event.';
        return null;
      }
      return { mode: 'race', durationWeeks: this.durationWeeks, raceEventId: this.selectedEvent.eventId };
    }
    const endDayMs = this.parseDateInput(this.periodEndDate);
    if (endDayMs === null) {
      this.errorMessage = 'Choose the final day of the historical build.';
      return null;
    }
    return { mode: 'period', durationWeeks: this.durationWeeks, endDayMs };
  }

  private async persist(selection: TrainingBuildBenchmarkSelection | null): Promise<void> {
    this.isSaving = true;
    this.errorMessage = null;
    try {
      const request: SetTrainingBuildBenchmarkRequest = {
        discipline: this.data.discipline,
        selection,
        ...(selection?.mode === 'race' && this.selectedEventNeedsRaceTag
          ? { markRaceEventId: selection.raceEventId }
          : {}),
      };
      const response = await this.functionsService.call<
        SetTrainingBuildBenchmarkRequest,
        SetTrainingBuildBenchmarkResponse
      >('setTrainingBuildBenchmark', request);

      if (response?.data?.accepted !== true) {
        throw new Error(
          'The benchmark was saved, but the comparison could not be queued. Try again.',
        );
      }

      this.dialogRef.close({ saved: true, selection });
    } catch (error) {
      this.errorMessage = this.resolveErrorMessage(error);
    } finally {
      this.isSaving = false;
    }
  }

  private defaultPeriodEndDayMs(): number {
    return this.resolveAsOfDayMs() - ((12 * 7) * DAY_MS);
  }

  private refreshEventOptions(): void {
    this.visibleSuggestedRaces = this.toEventOptions(this.data.suggestedRaces);
    this.visibleSuggestedEvents = this.toEventOptions(this.data.suggestedEvents || [])
      .filter(event => this.matchesEventPickerDateFilter(event))
      .sort((left, right) => this.compareSuggestedEvents(left, right));
    this.refreshDisplayedSuggestedRaces();
    this.refreshSelectedEvent();
  }

  private toEventOptions(events: readonly DerivedTrainingBuildEventSuggestion[]): TrainingBuildEventOption[] {
    const currentStartDayMs = this.resolveCurrentBuildStartDayMs();
    return [...events]
      .sort((left, right) => right.startDayMs - left.startDayMs || left.eventId.localeCompare(right.eventId))
      .map(event => ({
        ...event,
        isEligible: (event.startDayMs - DAY_MS) < currentStartDayMs,
        detailsText: this.formatEventDetails(event),
        displayLabel: this.resolveEventDisplayLabel(event.label),
      }));
  }

  private matchesEventPickerDateFilter(event: TrainingBuildEventOption): boolean {
    const recentBoundaryDayMs = this.resolveAsOfDayMs() - (365 * DAY_MS);
    if (this.eventDateFilter === 'recent') {
      return event.startDayMs >= recentBoundaryDayMs;
    }
    if (this.eventDateFilter === 'earlier') {
      return event.startDayMs < recentBoundaryDayMs;
    }
    return true;
  }

  private compareSuggestedEvents(left: TrainingBuildEventOption, right: TrainingBuildEventOption): number {
    if (this.eventSort === 'longest') {
      return this.compareNullableMetricDescending(left.durationSeconds, right.durationSeconds)
        || this.compareByMostRecent(left, right);
    }
    if (this.eventSort === 'highest-load') {
      return this.compareNullableMetricDescending(left.trainingStressScore, right.trainingStressScore)
        || this.compareByMostRecent(left, right);
    }
    return this.compareByMostRecent(left, right);
  }

  private compareNullableMetricDescending(left: number | null, right: number | null): number {
    if (left === null && right === null) {
      return 0;
    }
    if (left === null) {
      return 1;
    }
    if (right === null) {
      return -1;
    }
    return right - left;
  }

  private compareByMostRecent(
    left: Pick<TrainingBuildEventOption, 'eventId' | 'startDayMs'>,
    right: Pick<TrainingBuildEventOption, 'eventId' | 'startDayMs'>,
  ): number {
    return right.startDayMs - left.startDayMs || left.eventId.localeCompare(right.eventId);
  }

  private formatEventDetails(event: DerivedTrainingBuildEventSuggestion): string {
    const details = [
      this.formatEventDistance(event.distanceMeters),
      Number.isFinite(event.durationSeconds) ? formatSleepDuration(event.durationSeconds) : null,
      Number.isFinite(event.trainingStressScore) ? `${new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 0,
      }).format(event.trainingStressScore)} TSS` : null,
    ].filter((detail): detail is string => !!detail && detail !== '--');
    return details.join(' · ') || 'Activity details unavailable';
  }

  private formatEventDistance(value: number | null): string | null {
    if (value === null || !Number.isFinite(value)) {
      return null;
    }
    return resolveUnitAwareDisplayStat(new DataDistance(value), this.data.unitSettings, { stripRepeatedUnit: true })?.text
      || `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1000)} km`;
  }

  private resolveEventDisplayLabel(value: string | null): string | null {
    const label = `${value || ''}`.trim();
    return label && label.toLocaleLowerCase() !== 'new event' ? label : null;
  }

  private refreshDisplayedSuggestedRaces(): void {
    this.displayedSuggestedRaces = this.isRaceListExpanded
      ? this.visibleSuggestedRaces
      : this.visibleSuggestedRaces.slice(0, TAGGED_RACES_COLLAPSED_LIMIT);
  }

  private refreshSelectedEvent(): void {
    const selected = [...this.visibleSuggestedRaces, ...this.toEventOptions(this.data.suggestedEvents || [])]
      .find(event => event.eventId === this.eventId) || null;
    this.selectedEvent = selected;
    this.selectedEventNeedsRaceTag = !!selected
      && !this.visibleSuggestedRaces.some(event => event.eventId === selected.eventId);
    this.selectedBenchmarkEndDayMs = selected ? selected.startDayMs - DAY_MS : null;
    this.selectedBuildStartDayMs = this.selectedBenchmarkEndDayMs === null
      ? null
      : this.selectedBenchmarkEndDayMs - ((this.durationWeeks * 7 - 1) * DAY_MS);
    this.refreshSaveActionLabel();
  }

  private refreshSaveActionLabel(): void {
    if (this.mode === 'period') {
      this.saveActionLabel = 'Save benchmark';
      this.canSave = true;
      return;
    }
    this.canSave = !!this.selectedEvent?.isEligible;
    this.saveActionLabel = this.selectedEventNeedsRaceTag ? 'Mark as Race and use event' : 'Use event';
  }

  private resolveCurrentBuildStartDayMs(): number {
    return this.resolveAsOfDayMs() - ((this.durationWeeks * 7 - 1) * DAY_MS);
  }

  private resolveAsOfDayMs(): number {
    const asOf = Number(this.data.asOfDayMs);
    if (Number.isFinite(asOf)) {
      const date = new Date(asOf);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  private formatDateInput(dayMs: number): string {
    const date = new Date(dayMs);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
  }

  private parseDateInput(value: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
  }

  private resolveErrorMessage(error: unknown): string {
    const message = `${(error as { message?: unknown } | null)?.message || ''}`.trim();
    return message || 'Could not save this benchmark. Please try again.';
  }
}
