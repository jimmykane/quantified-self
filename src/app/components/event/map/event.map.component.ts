import {Component, Input, OnInit, ViewChild} from '@angular/core';
import seedColor from 'seed-color';
import {ActivityInterface} from '../../../entities/activities/activity.interface';
import {AgmMap, GoogleMapsAPIWrapper, LatLng, LatLngBounds} from "@agm/core";


@Component({
  selector: 'app-event-map',
  templateUrl: './event.map.component.html',
  styleUrls: ['./event.map.component.css'],
  providers: [GoogleMapsAPIWrapper]
})
export class EventMapComponent {
  @Input() activities: ActivityInterface[];
  @ViewChild(AgmMap) agmMap;

  constructor() {
  }


  getActivityColor(seed: string): string {
    return seedColor(seed).toHex();
  }

}
