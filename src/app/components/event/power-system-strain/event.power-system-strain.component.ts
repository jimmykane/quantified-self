import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { ActivityInterface } from '@sports-alliance/sports-lib';
import {
  buildPowerSystemStrainWorkoutViewModels,
  type PowerSystemStrainWorkoutViewModel,
} from '../../../helpers/power-system-strain.helper';

@Component({
  selector: 'app-event-power-system-strain',
  templateUrl: './event.power-system-strain.component.html',
  styleUrls: ['./event.power-system-strain.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class EventPowerSystemStrainComponent {
  private selectedActivities: ActivityInterface[] = [];

  public workoutViewModels: PowerSystemStrainWorkoutViewModel[] = [];

  @Input()
  set activities(value: ActivityInterface[]) {
    this.selectedActivities = Array.isArray(value) ? value : [];
    this.workoutViewModels = buildPowerSystemStrainWorkoutViewModels(this.selectedActivities);
  }

  get activities(): ActivityInterface[] {
    return this.selectedActivities;
  }
}
