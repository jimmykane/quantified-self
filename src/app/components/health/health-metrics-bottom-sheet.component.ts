import { ChangeDetectionStrategy, Component, inject, type Signal } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatListModule } from '@angular/material/list';
import { SharedModule } from '../../modules/shared.module';
import { AppHapticsService } from '../../services/app.haptics.service';
import { healthMetricIcon } from '../../helpers/health-metric-icon.helper';
import type { HealthMetricCatalogGroup, HealthWorkspaceMetricSelection } from '../../helpers/health-workspace.helper';

export interface HealthMetricsData {
  groups: Signal<readonly HealthMetricCatalogGroup[]>;
  showSleep: Signal<boolean>;
  selected: HealthWorkspaceMetricSelection;
}

@Component({
  selector: 'app-health-metrics-bottom-sheet',
  standalone: true,
  imports: [SharedModule, MatListModule],
  templateUrl: './health-metrics-bottom-sheet.component.html',
  styleUrls: ['./health-metrics-bottom-sheet.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthMetricsBottomSheetComponent {
  readonly data = inject<HealthMetricsData>(MAT_BOTTOM_SHEET_DATA);
  readonly healthMetricIcon = healthMetricIcon;
  private readonly sheet = inject(MatBottomSheetRef<HealthMetricsBottomSheetComponent, HealthWorkspaceMetricSelection>);
  private readonly haptics = inject(AppHapticsService);

  select(metric: HealthWorkspaceMetricSelection): void {
    const available = metric === 'sleep' ? this.data.showSleep()
      : this.data.groups().some(group => group.metrics.some(option => option.id === metric));
    if (!available) return;
    // The workspace owns selection feedback and persistence after its lifecycle check.
    this.sheet.dismiss(metric);
  }

  close(): void {
    this.haptics.selection();
    this.sheet.dismiss();
  }
}
