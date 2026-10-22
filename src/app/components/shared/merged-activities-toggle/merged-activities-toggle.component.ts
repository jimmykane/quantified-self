import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MaterialModule } from '../../../modules/material.module';

@Component({
  selector: 'app-merged-activities-toggle',
  standalone: true,
  imports: [MaterialModule],
  templateUrl: './merged-activities-toggle.component.html',
  styleUrl: './merged-activities-toggle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MergedActivitiesToggleComponent {
  readonly checked = input(false);
  readonly disabled = input(false);
  readonly label = input('Merged activities');
  readonly hint = input('Merged activities are excluded');
  // The owner accepts the change and provides haptic feedback.
  readonly checkedChange = output<boolean>();
}
