import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit,
} from '@angular/core';
import {DataInterface} from '../../../../entities/data/data.interface';
import {DataLatitudeDegrees} from '../../../../entities/data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../../entities/data/data.longitude-degrees';
import {EventInterface} from '../../../../entities/events/event.interface';
import {AmChartsService} from '@amcharts/amcharts3-angular';
import {DataHeartRate} from '../../../../entities/data/data.heart-rate';
import {DataCadence} from '../../../../entities/data/data.cadence';
import {DataAltitude} from '../../../../entities/data/data.altitude';
import {DataSpeed} from '../../../../entities/data/data.speed';
import {DataVerticalSpeed} from '../../../../entities/data/data.verticalspeed';
import {DataSeaLevelPressure} from '../../../../entities/data/data.sea-level-pressure';
import {Log, Level} from 'ng2-logger'
import {ActivityInterface} from '../../../../entities/activities/activity.interface';
import {PointInterface} from '../../../../entities/points/point.interface';


@Component({
  selector: 'app-event-card-tools',
  templateUrl: './event.card.tools.component.html',
  styleUrls: ['./event.card.tools.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EventCardToolsComponent implements OnChanges, OnInit, OnDestroy {

  @Input() event: EventInterface;

  constructor() {
  }

  ngOnInit() {
  }

  ngOnChanges(): void {
  }
  ngOnDestroy() {
  }
}
