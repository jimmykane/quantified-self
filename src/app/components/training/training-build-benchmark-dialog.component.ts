import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type {
  DerivedTrainingBuildRaceSuggestion,
  DerivedTrainingDiscipline,
  SetTrainingBuildBenchmarkRequest,
  SetTrainingBuildBenchmarkResponse,
  TrainingBuildBenchmarkSelection,
  TrainingBuildDurationWeeks,
} from '@shared/derived-metrics';
import { AppFunctionsService } from '../../services/app.functions.service';

export interface TrainingBuildBenchmarkDialogData {
  discipline: DerivedTrainingDiscipline;
  asOfDayMs: number;
  suggestedRaces: DerivedTrainingBuildRaceSuggestion[];
  selection: TrainingBuildBenchmarkSelection | null;
}

@Component({
  selector: 'app-training-build-benchmark-dialog',
  templateUrl: './training-build-benchmark-dialog.component.html',
  styleUrls: ['./training-build-benchmark-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TrainingBuildBenchmarkDialogComponent {
  public mode: 'race' | 'period';
  public durationWeeks: TrainingBuildDurationWeeks;
  public raceEventId: string | null;
  public periodEndDate: string;
  public isSaving = false;
  public errorMessage: string | null = null;
  public visibleSuggestedRaces: DerivedTrainingBuildRaceSuggestion[] = [];

  constructor(
    @Inject(MAT_DIALOG_DATA) public readonly data: TrainingBuildBenchmarkDialogData,
    private readonly dialogRef: MatDialogRef<TrainingBuildBenchmarkDialogComponent>,
    private readonly functionsService: AppFunctionsService,
  ) {
    const selection = data.selection;
    this.durationWeeks = selection?.durationWeeks || 12;
    this.refreshVisibleSuggestedRaces();
    this.mode = selection?.mode || (this.visibleSuggestedRaces.length ? 'race' : 'period');
    this.raceEventId = selection?.mode === 'race' ? selection.raceEventId : this.visibleSuggestedRaces[0]?.eventId || null;
    this.periodEndDate = selection?.mode === 'period'
      ? this.formatDateInput(selection.endDayMs)
      : this.formatDateInput(this.defaultPeriodEndDayMs());
  }

  public selectMode(mode: 'race' | 'period'): void {
    this.mode = mode;
    if (mode === 'race' && !this.visibleSuggestedRaces.some(race => race.eventId === this.raceEventId)) {
      this.raceEventId = this.visibleSuggestedRaces[0]?.eventId || null;
    }
    this.errorMessage = null;
  }

  public selectDurationWeeks(durationWeeks: TrainingBuildDurationWeeks): void {
    this.durationWeeks = durationWeeks;
    this.refreshVisibleSuggestedRaces();
    if (this.mode === 'race' && !this.visibleSuggestedRaces.some(race => race.eventId === this.raceEventId)) {
      this.raceEventId = this.visibleSuggestedRaces[0]?.eventId || null;
    }
    this.errorMessage = null;
  }

  public selectRace(eventId: string): void {
    this.raceEventId = eventId;
    this.errorMessage = null;
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
    if (this.mode === 'race') {
      if (!this.raceEventId) {
        this.errorMessage = 'Choose a tagged race, or use a manual period.';
        return null;
      }
      return { mode: 'race', durationWeeks: this.durationWeeks, raceEventId: this.raceEventId };
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
      const response = await this.functionsService.call<
        SetTrainingBuildBenchmarkRequest,
        SetTrainingBuildBenchmarkResponse
      >('setTrainingBuildBenchmark', {
        discipline: this.data.discipline,
        selection,
      });

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
    return this.resolveAsOfDayMs() - ((12 * 7) * 24 * 60 * 60 * 1000);
  }

  private refreshVisibleSuggestedRaces(): void {
    const currentStartDayMs = this.resolveAsOfDayMs() - ((this.durationWeeks * 7 - 1) * 24 * 60 * 60 * 1000);
    this.visibleSuggestedRaces = this.data.suggestedRaces.filter(
      race => (race.startDayMs - (24 * 60 * 60 * 1000)) < currentStartDayMs,
    );
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
