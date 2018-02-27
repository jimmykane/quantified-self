import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, Input, OnChanges, OnInit,
  ViewChild
} from '@angular/core';
import {EventInterface} from '../../../../../entities/events/event.interface';
import {AgmMap, LatLngBoundsLiteral} from '@agm/core';
import {PointInterface} from '../../../../../entities/points/point.interface';
import {ActivityInterface} from "../../../../../entities/activities/activity.interface";


@Component({
  selector: 'app-event-card-map-agm',
  templateUrl: './event.card.map.agm.component.html',
  styleUrls: ['./event.card.map.agm.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardMapAGMComponent implements OnChanges, OnInit {
  @ViewChild(AgmMap) agmMap;
  @Input() event: EventInterface;
  @Input() resize: boolean;
  @Input() activities: ActivityInterface[];

  constructor(private changeDetectorRef: ChangeDetectorRef) {
  }

  ngOnInit() {
    if (this.event.getActivities().length === 1) {
      this.activities = [this.event.getFirstActivity()];
    }
  }

  ngOnChanges() {
    // @todo maybe this can be done in a different way
    this.agmMap.triggerResize().then(() => {
      this.agmMap._mapsWrapper.fitBounds(this.getBounds())
    });
  }

  onSelectedActivities(activities) {
    this.activities = activities;
  }

  getActivityColor(index: number): string {
    switch (index) {
      case 0: {
        return '#000000';
      }
      case 1: {
        return '#1881ea';
      }
      case 2: {
        return '#71be76';
      }
      case 3: {
        return '#a51e38';
      }
      case 4: {
        return '#d38e2e';
      }
      case 5: {
        return '#2dd86d';
      }
    }
    return '#' + Math.floor((Math.abs(Math.sin(index) * 16777215)) % 16777215).toString(16);
  }

  getBounds(): LatLngBoundsLiteral {
    const pointsWithPosition = this.event.getPointsWithPosition();
    if (!pointsWithPosition.length) {
      return;
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

  @HostListener('window:resize', ['$event.target.innerWidth'])
  onResize(width) {
    this.agmMap.triggerResize().then(() => {
      this.agmMap._mapsWrapper.fitBounds(this.getBounds())
    });
  }
}

