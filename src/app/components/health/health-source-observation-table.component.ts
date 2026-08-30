import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  HealthObservationTableRow,
  HealthSleepObservationRow,
} from '../../helpers/health-workspace.helper';

@Component({
  selector: 'app-health-source-observation-table',
  standalone: true,
  templateUrl: './health-source-observation-table.component.html',
  styleUrls: ['./health-source-observation-table.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthSourceObservationTableComponent {
  readonly sleep = input.required<boolean>();
  readonly detailTitle = input.required<string>();
  readonly sleepRows = input.required<readonly HealthSleepObservationRow[]>();
  readonly metricRows = input.required<readonly HealthObservationTableRow[]>();
  readonly truncationText = input<string | null>(null);
}
