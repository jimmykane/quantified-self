import {
  ChangeDetectionStrategy, Component, HostListener, Input, OnChanges, OnInit,
  ViewChild
} from '@angular/core';
import {EventInterface} from '../../../../../entities/events/event.interface';
import {AgmMap, LatLngBoundsLiteral} from '@agm/core';
import {PointInterface} from '../../../../../entities/points/point.interface';
import {AppEventColorService} from '../../../../../services/color/app.event.color.service';
import {ActivityInterface} from '../../../../../entities/activities/activity.interface';
import {LapInterface} from '../../../../../entities/laps/lap.interface';
import {DataPositionInterface} from '../../../../../entities/data/data.position.interface';
import {GoogleMapsAPIWrapper} from '@agm/core/services/google-maps-api-wrapper';


@Component({
  selector: 'app-event-card-map-agm',
  templateUrl: './event.card.map.agm.component.html',
  styleUrls: ['./event.card.map.agm.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardMapAGMComponent implements OnChanges, OnInit {
  @ViewChild(AgmMap) agmMap;
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[] = [];

  public openedLapMarkerInfoWindow: LapInterface;
  public openedActivityStartMarkerInfoWindow: ActivityInterface;

  constructor(public eventColorService: AppEventColorService) {
  }

  ngOnInit() {
  }

  ngOnChanges() {
    if (this.event.getActivities().length === 1) {
      this.selectedActivities.push(this.event.getFirstActivity());
    }
  }

  onSelectedActivities(activities) {
    this.selectedActivities = activities;
    this.agmMap.triggerResize().then(() => {
      const googleMaps: GoogleMapsAPIWrapper = this.agmMap._mapsWrapper;
      googleMaps.fitBounds(this.getBounds());
    });
  }

  getBounds(): LatLngBoundsLiteral {
    const pointsWithPosition = this.event.getPointsWithPosition(void 0, void 0, this.selectedActivities);
    if (!pointsWithPosition.length) {
      return <LatLngBoundsLiteral>{
        east: 0,
        west: 0,
        north: 0,
        south: 0
      };
    }
    const mostEast = pointsWithPosition.reduce((acc: PointInterface, point: PointInterface) => {
      return (acc.getPosition().longitudeDegrees < point.getPosition().longitudeDegrees) ? point : acc;
    });
    const mostWest = pointsWithPosition.reduce((acc: any, point: PointInterface) => {
      return (acc.getPosition().longitudeDegrees > point.getPosition().longitudeDegrees) ? point : acc;
    });
    const mostNorth = pointsWithPosition.reduce((acc: any, point: PointInterface) => {
      return (acc.getPosition().latitudeDegrees < point.getPosition().latitudeDegrees) ? point : acc;
    });
    const mostSouth = pointsWithPosition.reduce((acc: any, point: PointInterface) => {
      return (acc.getPosition().latitudeDegrees > point.getPosition().latitudeDegrees) ? point : acc;
    });
    return <LatLngBoundsLiteral>{
      east: mostEast.getPosition().longitudeDegrees,
      west: mostWest.getPosition().longitudeDegrees,
      north: mostNorth.getPosition().latitudeDegrees,
      south: mostSouth.getPosition().latitudeDegrees
    };
  }

  getStartPosition(activity: ActivityInterface): DataPositionInterface {
    return this.event.getPointsWithPosition(void 0, void 0, [activity])[0].getPosition();
  }

  getLapEndPosition(activity, lap: LapInterface): DataPositionInterface {
    const lapPoints = this.event.getPointsWithPosition(lap.startDate, lap.endDate, [activity]);
    return lapPoints[lapPoints.length - 1].getPosition();
  }

  openLapMarkerInfoWindow(lap) {
    this.openedLapMarkerInfoWindow = lap;
  }

  openActivityStartMarkerInfoWindow(activity) {
    this.openedActivityStartMarkerInfoWindow = activity;
  }

  @HostListener('window:resize', ['$event.target.innerWidth'])
  onResize(width) {
    this.agmMap.triggerResize().then(() => {
      this.agmMap._mapsWrapper.fitBounds(this.getBounds())
    });
  }
}

