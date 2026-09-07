import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  HealthObservationTableRow,
  HealthSleepObservationRow,
  ManualHealthObservationEdit,
} from '../../helpers/health-workspace.helper';

@Component({
  selector: 'app-health-source-observation-table',
  standalone: true,
  imports: [MatButtonModule, MatExpansionModule, MatIconModule, MatTooltipModule],
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
  readonly editManualMeasurement = output<ManualHealthObservationEdit>();
  readonly deleteManualMeasurement = output<ManualHealthObservationEdit>();
}
