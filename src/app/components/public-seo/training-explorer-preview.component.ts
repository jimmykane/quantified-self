import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { AppThemes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { AppThemeService } from '../../services/app.theme.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { TrainingReadinessTrendChartComponent } from '../training/training-readiness-trend-chart.component';
import { TrainingPowerSystemsTrendChartComponent } from '../training/training-power-systems-trend-chart.component';
import { TrainingDurabilityTrajectoryChartComponent } from '../training/training-durability-trajectory-chart.component';
import { TrainingBuildMetricsComponent } from '../shared/training-summary/training-build-metrics.component';
import { TrainingMixDetailsComponent } from '../shared/training-summary/training-mix-details.component';
import { buildTrainingPreviewBuildRows, buildTrainingPreviewMix, TRAINING_PREVIEW_DURABILITY, TRAINING_PREVIEW_POWER, TRAINING_PREVIEW_READINESS, TRAINING_PREVIEW_SPORTS, type TrainingPreviewSport } from './training-explorer-preview.data';

/** Presentation only. No auth, Firestore, snapshot refreshes or provider dependencies. */
@Component({
  selector: 'app-training-explorer-preview', standalone: true,
  imports: [MatTabsModule, MatButtonToggleModule, TrainingReadinessTrendChartComponent,
    TrainingPowerSystemsTrendChartComponent, TrainingDurabilityTrajectoryChartComponent,
    TrainingBuildMetricsComponent, TrainingMixDetailsComponent],
  templateUrl: './training-explorer-preview.component.html',
  styleUrl: './training-explorer-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingExplorerPreviewComponent {
  readonly kind = input<'readiness' | 'explorer'>('explorer');
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  private readonly theme = inject(AppThemeService);
  private readonly haptics = inject(AppHapticsService);
  readonly darkTheme = computed(() => this.theme.appTheme() === AppThemes.Dark);
  readonly sports = TRAINING_PREVIEW_SPORTS;
  readonly selectedSport = signal<TrainingPreviewSport>('Cycling');
  readonly selectedTab = signal(0);
  readonly mix = computed(() => buildTrainingPreviewMix(this.selectedSport(), this.unitSettings()));
  readonly buildRows = computed(() => buildTrainingPreviewBuildRows(this.unitSettings()));
  readonly readiness = TRAINING_PREVIEW_READINESS;
  readonly power = TRAINING_PREVIEW_POWER;
  readonly durability = TRAINING_PREVIEW_DURABILITY;

  selectSport(value: TrainingPreviewSport): void {
    if (!this.sports.includes(value) || value === this.selectedSport()) return;
    this.selectedSport.set(value);
    this.haptics.selection();
  }

  selectTab(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index > 3 || index === this.selectedTab()) return;
    this.selectedTab.set(index);
    this.haptics.selection();
  }
}
