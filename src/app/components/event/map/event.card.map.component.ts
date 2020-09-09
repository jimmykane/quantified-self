import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { AgmMap, } from '@agm/core';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';
import { ActivityInterface } from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import { LapInterface } from '@sports-alliance/sports-lib/lib/laps/lap.interface';
import { Log } from 'ng2-logger/browser';
import { AppEventService } from '../../../services/app.event.service';
import { Subject, Subscription } from 'rxjs';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { LapTypes } from '@sports-alliance/sports-lib/lib/laps/lap.types';
import { MapThemes } from '@sports-alliance/sports-lib/lib/users/settings/user.map.settings.interface';
import { AppUserService } from '../../../services/app.user.service';
import { AppActivityCursorService } from '../../../services/activity-cursor/app-activity-cursor.service';
import { GeoLibAdapter } from '@sports-alliance/sports-lib/lib/geodesy/adapters/geolib.adapter';
import { debounceTime } from 'rxjs/operators';
import { MapAbstract } from '../../map/map.abstract';
import { DataLatitudeDegrees } from '@sports-alliance/sports-lib/lib/data/data.latitude-degrees';
import { DataLongitudeDegrees } from '@sports-alliance/sports-lib/lib/data/data.longitude-degrees';

@Component({
  selector: 'app-event-card-map',
  templateUrl: './event.card.map.component.html',
  styleUrls: ['./event.card.map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventCardMapComponent extends MapAbstract implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @ViewChild(AgmMap) agmMap;
  @Input() event: EventInterface;
  @Input() targetUserID: string;
  @Input() user: User;
  @Input() selectedActivities: ActivityInterface[];
  @Input() theme: MapThemes;
  @Input() showLaps: boolean;
  @Input() showPoints: boolean;
  @Input() showArrows: boolean;
  @Input() strokeWidth: number;
  @Input() lapTypes: LapTypes[] = [];

  public activitiesMapData: MapData[] = [];
  public noMapData = false;
  public openedLapMarkerInfoWindow: LapInterface;
  public openedActivityStartMarkerInfoWindow: ActivityInterface;
  public mapTypeIds: ['hybrid', 'roadmap', 'satellite', 'terrain'];
  /** key is the activity id **/
  public activitiesCursors: Map<string, { latitudeDegrees: number, longitudeDegrees: number }> = new Map();
  private activitiesCursorSubscription: Subscription;
  private lineMouseMoveSubject: Subject<{event: google.maps.PolyMouseEvent, activityMapData: MapData }> = new Subject()
  private lineMouseMoveSubscription: Subscription;

  private logger = Log.create('EventCardMapAGMComponent');

  constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private eventService: AppEventService,
    private userService: AppUserService,
    private activityCursorService: AppActivityCursorService,
    public eventColorService: AppEventColorService) {
    super(changeDetectorRef);
  }


  ngOnInit() {
    if (!this.targetUserID || !this.event) {
      throw new Error('Component needs events and userID');
    }
    this.lineMouseMoveSubscription = this.lineMouseMoveSubject.pipe(
      // debounceTime(250)
    ).subscribe(value => {
      this.lineMouseMove(value.event, value.activityMapData);
    });
    this.logger.info(`Initialized`);
  }

  ngAfterViewInit(): void {
  }


  ngOnChanges(simpleChanges) {
    if ((simpleChanges.event
      || simpleChanges.selectedActivities
      || simpleChanges.lapTypes
      // || simpleChanges.showArrows
      || simpleChanges.showLaps)) {
      this.bindToNewData();
    }

  }

  openLapMarkerInfoWindow(lap) {
    this.openedLapMarkerInfoWindow = lap;
    this.openedActivityStartMarkerInfoWindow = void 0;
  }

  openActivityStartMarkerInfoWindow(activity) {
    this.openedActivityStartMarkerInfoWindow = activity;
    this.openedLapMarkerInfoWindow = void 0;
  }

  getMarkerIcon(activity: ActivityInterface) {
    return {
      path: 'M22-48h-44v43h16l6 5 6-5h16z',
      fillColor: this.eventColorService.getActivityColor(this.event.getActivities(), activity),
      fillOpacity: 1,
      strokeColor: '#FFF',
      strokeWeight: 0.5,
      scale: 0.5,
      labelOrigin: {
        x: 0,
        y: -24
      }
    }
  }

  //
  getHomeMarkerIcon(activity: ActivityInterface) {
    return {
      path: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
      fillColor: this.eventColorService.getActivityColor(this.event.getActivities(), activity),
      fillOpacity: 1,
      strokeColor: '#FFF',
      strokeWeight: 0.8,
      scale: 1.2,
      anchor: {x: 12, y: 12}
    }
  }

  getCircleMarkerIcon(activity: ActivityInterface) {
    return {
      path: 0,
      fillColor: this.eventColorService.getActivityColor(this.event.getActivities(), activity),
      fillOpacity: 1,
      strokeColor: '#FFF',
      strokeWeight: 0.8,
      scale: 1.2,
      // anchor: {x: 12, y: 12}
    }
  }

  getFlagMarkerIcon(activity: ActivityInterface) {
    return {
      path: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z',
      fillColor: this.eventColorService.getActivityColor(this.event.getActivities(), activity),
      fillOpacity: 1,
      strokeColor: '#FFF',
      strokeWeight: 0.8,
      scale: 1,
      anchor: {x: 6, y: 24}
    }
  }

  getCursorMarkerIcon(activity: ActivityInterface) {
    return {
      path: 'M5 15H3v4c0 1.1.9 2 2 2h4v-2H5v-4zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zm0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zM12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
      fillColor: this.eventColorService.getActivityColor(this.event.getActivities(), activity),
      fillOpacity: 1,
      strokeColor: '#FFF',
      strokeWeight: 1,
      scale: 1.2,
      anchor: {x: 12, y: 12}
    }
  }

  // @todo make prop
  getLabel(text) {
    return {
      color: 'white',
      fontSize: '14px',
      text: text
    }
  }

  onLineMouseMove(event, activityMapData: MapData) {
    this.lineMouseMoveSubject.next({event: event, activityMapData: activityMapData});
  }

  private async lineMouseMove(event: google.maps.PolyMouseEvent, activityMapData: MapData) {
    this.activitiesCursors.set(activityMapData.activity.getID(), {
      latitudeDegrees: event.latLng.lat(),
      longitudeDegrees: event.latLng.lng()
    });
    this.changeDetectorRef.detectChanges();
    const nearest = <{ latitude: number, longitude: number, time: number }>(new GeoLibAdapter()).findNearest({
      latitude: event.latLng.lat(),
      longitude: event.latLng.lng()
    }, activityMapData.positions.map(a => {
      return {latitude: a.latitudeDegrees, longitude: a.longitudeDegrees, time: a.time}
    }));

    if (!nearest) {
      return;
    }

    // this.activityCursorService.clear();

    this.activityCursorService.setCursor({
      activityID: activityMapData.activity.getID(),
      time: nearest.time,
      byMap: true,
    });
  }

  lineMouseOut(event: google.maps.PolyMouseEvent, activityMapData: MapData) {
    // this.activitiesCursors.delete(activityMapData.activity.getID());
  }

  getMapValuesAsArray<K, V>(map: Map<K, V>): V[] {
    return Array.from(map.values());
  }

  async changeMapType(mapType) {
    if (!this.user) {
      return;
    }
    this.user.settings.mapSettings.mapType = mapType;
    await this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  @HostListener('window:resize', ['$event.target.innerWidth'])
  onResize(width) {
    // this.resizeMapToBounds();
  }

  ngOnDestroy(): void {
    this.unSubscribeFromAll();
  }

  private bindToNewData() {
    this.logger.info(`Binding to new data`);
    this.loading();
    this.noMapData = false;
    this.activitiesMapData = [];
    this.unSubscribeFromAll();
    if (!this.selectedActivities.length) {
      this.noMapData = true;
      this.loaded();
      return;
    }

    // Set the cursor
    this.activitiesCursorSubscription = this.activityCursorService.cursors.pipe(
      debounceTime(250)
    ).subscribe((cursors) => {
      this.logger.info(`Cursor on subscription`);
      cursors.filter(cursor => cursor.byChart === true).forEach(cursor => {
        console.log(cursor)
        const cursorActivityMapData = this.activitiesMapData.find(amd => amd.activity.getID() === cursor.activityID);
        if (cursorActivityMapData) {
          const position = cursorActivityMapData.positions.reduce((prev, curr) => Math.abs(curr.time - cursor.time) < Math.abs(prev.time - cursor.time) ? curr : prev);
          if (position) {
            this.activitiesCursors.set(cursor.activityID, {
              latitudeDegrees: position.latitudeDegrees,
              longitudeDegrees: position.longitudeDegrees
            });
            this.agmMap._mapsWrapper.panTo({
              lat: position.latitudeDegrees,
              lng: position.longitudeDegrees
            })
          }
        }
      });
      this.changeDetectorRef.detectChanges();
    });

    this.selectedActivities.forEach((activity) => {
      if (!activity.hasPositionData()) {
        return
      }
      // 1. We need the lat, long stream to get also the times for using the time for cursor reference
      const positionData = activity.getSquashedPositionData();
      const positions = activity.generateTimeStream([DataLatitudeDegrees.type, DataLongitudeDegrees.type])
        .getData(true)
        .reduce((positionWithTimeArray: PositionWithTime[], time, index): PositionWithTime[] => {
          positionWithTimeArray.push(Object.assign({time: activity.startDate.getTime()  + time * 1000}, positionData[index]))
            return positionWithTimeArray
          }, []);
      this.activitiesMapData.push({
        activity: activity,
        positions: positions,
        strokeColor: this.eventColorService.getActivityColor(this.event.getActivities(), activity),
        laps: activity.getLaps().reduce((laps, lap) => {
          // @todo gives back too big arrays should check the implementation of the activity method
          const lapPositionData = activity.getSquashedPositionData(lap.startDate, lap.endDate);
          if (!lapPositionData.length || !this.showLaps) {
            return laps;
          }
          if (this.lapTypes.indexOf(lap.type) === -1) {
            return laps;
          }
          laps.push({
            lap: lap,
            lapPosition: {
              latitudeDegrees: lapPositionData[lapPositionData.length - 1].latitudeDegrees,
              longitudeDegrees: lapPositionData[lapPositionData.length - 1].longitudeDegrees
            }
          });
          return laps;
        }, [])
      });

      this.loaded();
      this.resizeMapToBounds();
    })
  }

  private unSubscribeFromAll() {
    if (this.activitiesCursorSubscription) {
      this.activitiesCursorSubscription.unsubscribe();
    }
    if (this.lineMouseMoveSubscription) {
      this.lineMouseMoveSubscription.unsubscribe();
    }
  }

  private resizeMapToBounds() {
    if (!this.agmMap) {
      return;
    }
    this.agmMap.triggerResize().then(() => {
      if (!this.agmMap) {
        return;
      }
      this.agmMap._mapsWrapper.fitBounds(this.getBounds(this.activitiesMapData.reduce((pointsArray, activityData) => pointsArray.concat(activityData.positions), [])))
    });
  }
}


export interface MapData {
  activity: ActivityInterface;
  positions: PositionWithTime[];
  strokeColor: string;
  laps: {
    lap: LapInterface,
    lapPosition: { latitudeDegrees: number, longitudeDegrees: number, time: number },
    symbol: any,
  }[]
}

export interface PositionWithTime {
  latitudeDegrees: number,
  longitudeDegrees: number,
  time: number
}

