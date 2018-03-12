import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit,
} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';
import {ActivityInterface} from "../../../../entities/activities/activity.interface";
import {DataHeartRate} from "../../../../entities/data/data.heart-rate";
import {Point} from "../../../../entities/points/point";
import {PointInterface} from "../../../../entities/points/point.interface";

@Component({
  selector: 'app-event-card-tools',
  templateUrl: './event.card.tools.component.html',
  styleUrls: ['./event.card.tools.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EventCardToolsComponent implements OnChanges, OnInit, OnDestroy {

  @Input() event: EventInterface;

  lowLimitFilterChecked: boolean;
  lowLimitFilterValue = 40;
  highLimitChecked: boolean;
  highLimitValue: 220;
  movingMedianChecked: boolean;
  movingMedianValue: 5;
  movingWeightAverageChecked: boolean;
  movingWeightAverageValue: 5;


  constructor() {
  }

  ngOnInit() {
  }

  ngOnChanges(): void {
  }

  ngOnDestroy() {
  }

  applyFilters() {
    this.event.getActivities().forEach((activity: ActivityInterface) => {
      const actvityIBIData = activity.getIBIData();
      if (this.lowLimitFilterChecked) {
        actvityIBIData.lowPassFilter(this.lowLimitFilterValue);
      }
      if (this.highLimitChecked) {
        actvityIBIData.highLimitBPMFilter(this.highLimitValue);
      }
      if (this.movingMedianChecked) {
        actvityIBIData.movingMedianFilter(this.movingMedianValue);
      }
      if (this.movingWeightAverageChecked) {
        actvityIBIData.lowPassFilter(this.movingWeightAverageValue);
      }

      // Remove all HR!
      activity.getPoints().forEach((point: PointInterface) => {
        if (point.getDataByType(DataHeartRate.type)) {
          point.removeDataByType(DataHeartRate.type);
        }
      });

      actvityIBIData.getAsBPM().forEach((value, key, map) => {
        const point = new Point(new Date(activity.getStartDate().getTime() + key));
        point.addData(new DataHeartRate(value));
        activity.addPoint(point);
      });
    })
  }
}
