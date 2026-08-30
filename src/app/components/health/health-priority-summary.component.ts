import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProviderPresentation } from '@shared/provider-presentation';
import {
  HealthPriorityRow,
  HealthWorkspaceMetricSelection,
} from '../../helpers/health-workspace.helper';
import { ServiceSourceIconComponent } from '../event-summary/service-source-icon/service-source-icon.component';

export interface HealthPriorityRowView extends HealthPriorityRow {
  presentation: ProviderPresentation | null;
}

export interface HealthPriorityCardView {
  id: 'sleep' | 'heart_rate' | 'heart_rate_variability';
  label: string;
  icon: string;
  metric: HealthWorkspaceMetricSelection;
  rows: HealthPriorityRowView[];
  loading: boolean;
  error: boolean;
  emptyText: string;
}

@Component({
  selector: 'app-health-priority-summary',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatProgressSpinnerModule, ServiceSourceIconComponent],
  templateUrl: './health-priority-summary.component.html',
  styleUrls: ['./health-priority-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthPrioritySummaryComponent {
  readonly cards = input.required<readonly HealthPriorityCardView[]>();
  readonly selectedMetric = input.required<HealthWorkspaceMetricSelection>();
  readonly metricSelected = output<HealthWorkspaceMetricSelection>();
}
