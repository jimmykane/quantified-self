import {
  ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, OnInit,
} from '@angular/core';
import {MatSnackBar} from '@angular/material/snack-bar';
import {AppEventService} from '../../../services/app.event.service';
import {EventInterface} from '@sports-alliance/sports-lib';
import {ActivityInterface} from '@sports-alliance/sports-lib';
import {DataHeartRate} from '@sports-alliance/sports-lib';
import {IBIData} from '@sports-alliance/sports-lib';
import {take} from 'rxjs/operators';
import {User} from '@sports-alliance/sports-lib';
import {DataIBI} from '@sports-alliance/sports-lib';

@Component({
    selector: 'app-event-card-tools',
    templateUrl: './event.card.tools.component.html',
    styleUrls: ['./event.card.tools.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class EventCardToolsComponent implements OnChanges, OnInit, OnDestroy {

  @Input() targetUserID: string;
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[];

  lowLimitFilterChecked: boolean;
  lowLimitFilterValue = 40;
  highLimitChecked: boolean;
  highLimitValue = 220;
  movingMedianChecked: boolean;
  movingMedianValue = 5;
  movingWeightAverageChecked: boolean;
  movingWeightAverageValue = 5;


  constructor(private snackBar: MatSnackBar, private eventService: AppEventService) {
  }

  ngOnInit() {
  }

  ngOnChanges(): void {
  }

  ngOnDestroy() {
  }

  async applyFilters(defaultFilters?: boolean, resetToRawIBIData?: boolean) {
    for (const activity of this.selectedActivities) {
      // Add the ibi stream
      activity.addStreams(await this.eventService.getStreamsByTypes(this.targetUserID, this.event.getID(), activity.getID(), [DataIBI.type]).pipe(take(1)).toPromise());
      if (!activity.hasStreamData(DataIBI.type)) {
        continue;
      }
      const ibiData = (new IBIData(activity.getStreamData(DataIBI.type)));
      const samples: any[] = [];

      // If we want the defaults
      if (defaultFilters) {
        ibiData
          .lowLimitBPMFilter()
          .highLimitBPMFilter()
          .movingMedianFilter()
          .lowPassFilter();
      } else if (!resetToRawIBIData) {
        if (this.lowLimitFilterChecked) {
          ibiData.lowLimitBPMFilter(this.lowLimitFilterValue);
        }
        if (this.highLimitChecked) {
          ibiData.highLimitBPMFilter(this.highLimitValue);
        }
        if (this.movingMedianChecked) {
          ibiData.movingMedianFilter(this.movingMedianValue);
        }
        if (this.movingWeightAverageChecked) {
          ibiData.lowPassFilter(this.movingWeightAverageValue);
        }
      }
      ibiData.getAsBPM().forEach((value, key, map) => {
        samples.push({
          TimeISO8601: (new Date(activity.startDate.getTime() + key)).toISOString(),
          HR: value / 60,
        })
      });
    }
    return;
    // this.selectedActivities.forEach((activity: ActivityInterface) => {
    //     // Create new not to alter existing
    //     const ibiData = new IBIData(Array.from(activity.ibiData.getIBIDataMap().values()));
    //     if (!ibiData.getIBIDataMap().size) {
    //       // Exit if this activity does not have ibiData
    //       return;
    //     }
    //     // Clear all current HR points
    //     activity.getPoints().forEach((point: PointInterface) => {
    //       if (point.getDataByType(DataHeartRate.type)) {
    //         point.removeDataByType(DataHeartRate.type);
    //       }
    //     });
    //     // If we want the defaults
    //     if (defaultFilters) {
    //       ibiData
    //         .lowLimitBPMFilter()
    //         .highLimitBPMFilter()
    //         .movingMedianFilter()
    //         .lowPassFilter();
    //     } else if (!resetToRawIBIData) {
    //       if (this.lowLimitFilterChecked) {
    //         ibiData.lowLimitBPMFilter(this.lowLimitFilterValue);
    //       }
    //       if (this.highLimitChecked) {
    //         ibiData.highLimitBPMFilter(this.highLimitValue);
    //       }
    //       if (this.movingMedianChecked) {
    //         ibiData.movingMedianFilter(this.movingMedianValue);
    //       }
    //       if (this.movingWeightAverageChecked) {
    //         ibiData.lowPassFilter(this.movingWeightAverageValue);
    //       }
    //     }
    //     // Else just get them as BPM and no filter
    //     ibiData.getAsBPM().forEach((value, key, map) => {
    //       const point = new Point(new Date(activity.startDate.getTime() + key));
    //       point.addData(new DataHeartRate(value));
    //       activity.addPoint(point);
    //     });
    //   },
    // );
    // Add and update via service
    // this.eventService.writeAllEventData(this.event);
    this.snackBar.open('Filters applied! Go to the chart to see the result', null, {
      duration: 2000,
    });
  }
}
