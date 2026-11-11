import {
  afterNextRender,
  computed,
  Injector,
  viewChildren,
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
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { MatCheckbox, MatCheckboxModule } from '@angular/material/checkbox';
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
  DashboardConfigurationConflict,
  DashboardConfigurationService,
  cloneDashboardSettings,
} from '../../../services/dashboard-configuration.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppUserService } from '../../../services/app.user.service';
import { NgTemplateOutlet } from '@angular/common';
import { DashboardTodayAvailabilityService } from '../../../services/dashboard-today-availability.service';
import { DashboardTodayDataService } from '../../../services/dashboard-today-data.service';

@Component({
  selector: 'app-dashboard-today-editor',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DragDropModule,
  ],
  providers: [DashboardTodayAvailabilityService, DashboardTodayDataService],
  templateUrl: './dashboard-today-editor.component.html',
  styleUrl: './dashboard-today-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardTodayEditorComponent {
  readonly user = inject<AppUserInterface>(MAT_DIALOG_DATA);
  readonly evidence = inject(DashboardTodayAvailabilityService);
  readonly availabilityIcons = { ready: 'check_circle', history: 'history', 'no-data': 'info_outline', loading: 'hourglass_top', updating: 'sync', error: 'error_outline' };
  private readonly ref = inject(
    MatDialogRef<DashboardTodayEditorComponent, boolean>
  );
  private readonly persistence = inject(DashboardConfigurationService);
  private readonly users = inject(AppUserService);
  private readonly haptics = inject(AppHapticsService);
  private readonly destroy = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly checkboxes = viewChildren(MatCheckbox);
  private readonly baseline = cloneDashboardSettings(
    this.user.settings.dashboardSettings
  );
  private readonly initial = normalizeDashboardTodaySettings(
    this.baseline.today
  );
  readonly draft = signal(this.initial);
  readonly hasChanges = computed(() => !equal(this.draft(), this.initial));
  readonly isDefault = computed(() =>
    equal(this.draft(), defaultDashboardTodaySettings())
  );
  readonly catalog = DASHBOARD_TODAY_METRICS;
  readonly selected = signal(this.rows(this.draft().metrics));
  readonly saving = signal(false);
  readonly error = signal('');
  readonly summaries = [
    { id: 'trainingState', label: 'Training state' },
    { id: 'readiness', label: 'Readiness' },
  ] as const;
  readonly context = [
    {
      id: 'recordedActivities',
      label: 'Today’s activities',
      detail: 'Recorded activities with their sport, tags and duration, as shown in Calendar.',
    },
    {
      id: 'recovery',
      label: 'Recovery left',
      detail: 'Estimated recovery time remaining. Does not affect Readiness.',
    },
    {
      id: 'suggestion',
      label: 'Today’s suggestion',
      detail: 'Daily workout suggestion from the Assistant. Available with Pro.',
    },
  ] as const;
  constructor() {
    this.evidence.connect(this.user);
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
    key: 'trainingState' | 'readiness' | 'recovery' | 'suggestion' | 'recordedActivities',
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
    const label = this.catalog.find((metric) => metric.id === id)!.label;
    void this.announcer.announce(
      `${label} ${checked ? 'added to' : 'removed from'} Today.`
    );
    this.focusMetric(id);
  }
  private focusMetric(id: DashboardTodayMetricId): void {
    // A checkbox moves between the shown and available lists; preserve keyboard focus.
    afterNextRender(
      () => {
        if (!this.destroy.destroyed)
          this.checkboxes()
            .find((checkbox) => checkbox.id === `today-metric-${id}`)
            ?.focus();
      },
      { injector: this.injector }
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
    const id = metrics[target],
      label = this.catalog.find((metric) => metric.id === id)!.label;
    void this.announcer.announce(
      `${label} moved to position ${target + 1} of ${metrics.length}.`
    );
    this.focusMetric(id);
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
    void this.announcer.announce(
      'Default layout selected. Select Save changes to apply it.'
    );
  }
  cancel(): void {
    if (!this.saving()) {
      this.haptics.selection();
      this.ref.close(false);
    }
  }
  async save(): Promise<void> {
    if (this.saving() || this.users.user()?.uid !== this.user.uid) return;
    if (!this.hasChanges()) {
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
        error instanceof DashboardConfigurationConflict
          ? 'Your dashboard settings have changed. Reopen Customize Today and make your selections again.'
          : 'Unable to save your Today settings. Your selections have been retained. Please try again.'
      );
      this.haptics.error();
    } finally {
      if (!this.destroy.destroyed) this.saving.set(false);
    }
  }
}
