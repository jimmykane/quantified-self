import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import equal from 'fast-deep-equal';
import type {
  AppUserInterface,
  AppDashboardTodaySettings,
  DashboardTodayMetricId,
} from '../../../models/app-user.interface';
import {
  DASHBOARD_TODAY_METRICS,
  defaultDashboardTodaySettings,
  normalizeDashboardTodaySettings,
} from '../../../helpers/dashboard-today-settings.helper';
import {
  DashboardConfigurationService,
  cloneDashboardSettings,
} from '../../../services/dashboard-configuration.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppUserService } from '../../../services/app.user.service';

@Component({
  selector: 'app-dashboard-today-editor',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DragDropModule,
  ],
  templateUrl: './dashboard-today-editor.component.html',
  styleUrl: './dashboard-today-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardTodayEditorComponent {
  readonly user = inject<AppUserInterface>(MAT_DIALOG_DATA);
  private readonly ref = inject(
    MatDialogRef<DashboardTodayEditorComponent, boolean>
  );
  private readonly persistence = inject(DashboardConfigurationService);
  private readonly users = inject(AppUserService);
  private readonly haptics = inject(AppHapticsService);
  private readonly destroy = inject(DestroyRef);
  private readonly baseline = cloneDashboardSettings(
    this.user.settings.dashboardSettings
  );
  readonly draft = signal(normalizeDashboardTodaySettings(this.baseline.today));
  readonly catalog = DASHBOARD_TODAY_METRICS;
  readonly selected = signal(this.rows(this.draft().metrics));
  readonly saving = signal(false);
  readonly error = signal('');
  readonly summaries = [
    { id: 'trainingState', label: 'Training state' },
    { id: 'readiness', label: 'Readiness' },
  ] as const;
  readonly context = [
    { id: 'recovery', label: 'Recovery left' },
    { id: 'suggestion', label: 'Today’s suggestion' },
  ] as const;
  constructor() {
    effect(() => {
      if (this.users.user()?.uid !== this.user.uid) this.ref.close(false);
    });
    effect(() => {
      this.ref.disableClose = this.saving();
    });
  }
  private rows(ids: readonly DashboardTodayMetricId[]) {
    return ids.map((id) => this.catalog.find((row) => row.id === id)!);
  }
  toggleBlock(
    key: 'trainingState' | 'readiness' | 'recovery' | 'suggestion',
    checked: boolean
  ): void {
    if (this.saving() || this.draft()[key] === checked) return;
    this.haptics.selection();
    this.draft.update((value) => ({ ...value, [key]: checked }));
  }
  toggleMetric(id: DashboardTodayMetricId, checked: boolean): void {
    if (this.saving() || this.draft().metrics.includes(id) === checked) return;
    this.haptics.selection();
    this.setMetrics(
      checked
        ? [...this.draft().metrics, id]
        : this.draft().metrics.filter((value) => value !== id)
    );
  }
  private setMetrics(metrics: DashboardTodayMetricId[]) {
    this.draft.update((value) => ({ ...value, metrics }));
    this.selected.set(this.rows(metrics));
  }
  move(index: number, offset: number): void {
    const metrics = [...this.draft().metrics],
      target = index + offset;
    if (
      this.saving() ||
      target < 0 ||
      target >= metrics.length ||
      index === target
    )
      return;
    moveItemInArray(metrics, index, target);
    this.haptics.selection();
    this.setMetrics(metrics);
  }
  drop(event: CdkDragDrop<unknown>): void {
    this.move(event.previousIndex, event.currentIndex - event.previousIndex);
  }
  reset(): void {
    const defaults = defaultDashboardTodaySettings();
    if (this.saving() || equal(this.draft(), defaults)) return;
    this.haptics.selection();
    this.draft.set(defaults);
    this.selected.set(this.rows(defaults.metrics));
  }
  cancel(): void {
    if (!this.saving()) {
      this.haptics.selection();
      this.ref.close(false);
    }
  }
  async save(): Promise<void> {
    if (this.saving() || this.users.user()?.uid !== this.user.uid) return;
    if (
      equal(this.draft(), normalizeDashboardTodaySettings(this.baseline.today))
    ) {
      this.ref.close(false);
      return;
    }
    const today: AppDashboardTodaySettings = normalizeDashboardTodaySettings(
      this.draft()
    );
    this.haptics.selection();
    this.saving.set(true);
    this.error.set('');
    try {
      await this.persistence.save(this.user.uid, this.baseline, { today });
      if (this.destroy.destroyed || this.users.user()?.uid !== this.user.uid)
        return;
      this.user.settings.dashboardSettings = {
        ...this.user.settings.dashboardSettings,
        today,
      };
      this.haptics.success();
      this.ref.close(true);
    } catch (error) {
      if (this.destroy.destroyed || this.users.user()?.uid !== this.user.uid)
        return;
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Could not save Today. Please try again.'
      );
      this.haptics.error();
    } finally {
      if (!this.destroy.destroyed) this.saving.set(false);
    }
  }
}
