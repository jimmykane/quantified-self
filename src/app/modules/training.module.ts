import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { TrainingWorkspaceComponent } from '../components/training/training-workspace.component';
import { TrainingBuildBenchmarkDialogComponent } from '../components/training/training-build-benchmark-dialog.component';
import { TrainingSportVisibilityDialogComponent } from '../components/training/training-sport-visibility-dialog.component';
import { TrainingSwimPerformanceChartComponent } from '../components/training/training-swim-performance-chart.component';
import { TrainingRoutingModule } from '../training.routing.module';
import { AppChartsModule } from './app-charts.module';
import { MaterialModule } from './material.module';
import { SharedModule } from './shared.module';

@NgModule({
  imports: [CommonModule, SharedModule, MaterialModule, AppChartsModule, TrainingRoutingModule],
  declarations: [
    TrainingWorkspaceComponent,
    TrainingBuildBenchmarkDialogComponent,
    TrainingSportVisibilityDialogComponent,
    TrainingSwimPerformanceChartComponent,
  ],
})
export class TrainingModule {}
