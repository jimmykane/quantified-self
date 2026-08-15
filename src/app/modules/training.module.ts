import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import {
  TRAINING_WORKSPACE_PREFERENCE_WRITER,
  TrainingWorkspaceComponent,
} from '../components/training/training-workspace.component';
import { TrainingBuildBenchmarkDialogComponent } from '../components/training/training-build-benchmark-dialog.component';
import { TrainingSportVisibilityDialogComponent } from '../components/training/training-sport-visibility-dialog.component';
import { TrainingMobileDestinationSheetComponent } from '../components/training/training-mobile-destination-sheet.component';
import { TrainingSwimPerformanceChartComponent } from '../components/training/training-swim-performance-chart.component';
import { TrainingDurabilityTrajectoryChartComponent } from '../components/training/training-durability-trajectory-chart.component';
import { TrainingMetricTextComponent } from '../components/training/training-metric-text.component';
import { TrainingPowerSystemsTrendChartComponent } from '../components/training/training-power-systems-trend-chart.component';
import { TrainingReadinessTrendChartComponent } from '../components/training/training-readiness-trend-chart.component';
import { TrainingBodyWeightTrendChartComponent } from '../components/training/training-body-weight-trend-chart.component';
import { TrainingRoutingModule } from '../training.routing.module';
import { AppChartsModule } from './app-charts.module';
import { MaterialModule } from './material.module';
import { SharedModule } from './shared.module';
import { AppUserSettingsQueryService } from '../services/app.user-settings-query.service';

@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    AppChartsModule,
    TrainingRoutingModule,
    TrainingMobileDestinationSheetComponent,
  ],
  declarations: [
    TrainingWorkspaceComponent,
    TrainingBuildBenchmarkDialogComponent,
    TrainingSportVisibilityDialogComponent,
    TrainingSwimPerformanceChartComponent,
    TrainingDurabilityTrajectoryChartComponent,
    TrainingMetricTextComponent,
    TrainingPowerSystemsTrendChartComponent,
    TrainingReadinessTrendChartComponent,
    TrainingBodyWeightTrendChartComponent,
  ],
  providers: [
    { provide: TRAINING_WORKSPACE_PREFERENCE_WRITER, useExisting: AppUserSettingsQueryService },
  ],
})
export class TrainingModule {}
