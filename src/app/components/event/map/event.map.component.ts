import {Component, Input, ViewChild} from '@angular/core';
import seedColor from 'seed-color';
import {ActivityInterface} from '../../../entities/activities/activity.interface';
import {AgmMap, GoogleMapsAPIWrapper} from "@agm/core";
import {PointInterface} from "../../../entities/points/point.interface";
import {EventInterface} from "../../../entities/events/event.interface";


@Component({
  selector: 'app-event-map',
  templateUrl: './event.map.component.html',
  styleUrls: ['./event.map.component.css'],
  providers: [GoogleMapsAPIWrapper]
})
export class EventMapComponent {
  @Input() event: EventInterface[];
  @ViewChild(AgmMap) agmMap;

  constructor() {
  }

  getPointsWithPosition(activity: ActivityInterface): PointInterface[] {
    return activity.getPoints().reduce((pointsWithPosition: PointInterface[], point: PointInterface) => {
      if (point.getPosition()) {
        pointsWithPosition.push(point);
      }
      return pointsWithPosition;
    }, []);
  }


  getActivityColor(seed: string): string {
    return seedColor(seed).toHex();
  }

  ngAfterViewInit() {
    console.log(this.agmMap);
  }
}
