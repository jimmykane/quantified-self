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
import {AgmMap, LatLngBoundsLiteral, PolyMouseEvent} from '@agm/core';
import {EventColorService} from '../../../../services/color/app.event.color.service';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {LapInterface} from 'quantified-self-lib/lib/laps/lap.interface';
import {
  ControlPosition,
  MapTypeControlOptions,
  MapTypeId, RotateControlOptions,
  ZoomControlOptions
} from '@agm/core';
import {Log} from 'ng2-logger/browser';
import {EventService} from '../../../../services/app.event.service';
import {DataLatitudeDegrees} from 'quantified-self-lib/lib/data/data.latitude-degrees';
import {DataLongitudeDegrees} from 'quantified-self-lib/lib/data/data.longitude-degrees';
import {Subscription} from 'rxjs';
import {User} from 'quantified-self-lib/lib/users/user';
import {DataPositionInterface} from 'quantified-self-lib/lib/data/data.position.interface';
import {LapTypes} from 'quantified-self-lib/lib/laps/lap.types';
import {MapThemes} from 'quantified-self-lib/lib/users/user.map.settings.interface';
import {UserService} from '../../../../services/app.user.service';
import {LoadingAbstract} from '../../../loading/loading.abstract';
import {ActivityCursorService} from '../../../../services/activity-cursor/activity-cursor.service';
import {GeoLibAdapter} from 'quantified-self-lib/lib/geodesy/adapters/geolib.adapter';

declare function require(moduleName: string): any;

const mapStyles = require('./map-styles.json');

@Component({
  selector: 'app-event-card-map',
  templateUrl: './event.card.map.component.html',
  styleUrls: ['./event.card.map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventCardMapComponent extends LoadingAbstract implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @ViewChild(AgmMap) agmMap;
  @Input() event: EventInterface;
  @Input() targetUserID: string;
  @Input() user: User;
  @Input() selectedActivities: ActivityInterface[];
  @Input() theme: MapThemes;
  @Input() showLaps: boolean;
  @Input() showArrows: boolean;
  @Input() strokeWidth: number;
  @Input() lapTypes: LapTypes[] = [];


  private streamsSubscriptions: Subscription[] = [];
  public activitiesMapData: MapData[] = [];
  public noMapData = false;
  public openedLapMarkerInfoWindow: LapInterface;
  public openedActivityStartMarkerInfoWindow: ActivityInterface;
  public mapTypeControlOptions: MapTypeControlOptions = {
    // mapTypeIds: [MapTypeId.HYBRID, MapTypeId.ROADMAP, MapTypeId.SATELLITE, MapTypeId.TERRAIN],
    mapTypeIds: ['hybrid', 'roadmap', 'satellite', 'terrain'],
    position: ControlPosition.LEFT_TOP,
    style: 0
  };

  /** key is the activity id **/
  public activitiesCursors: Map<string, { latitudeDegrees: number, longitudeDegrees: number }> = new Map();

  public rotateControlOptions: RotateControlOptions = {
    position: ControlPosition.LEFT_BOTTOM,
  };

  public zoomControlOptions: ZoomControlOptions = {
    position: ControlPosition.RIGHT_TOP
  };

  private logger = Log.create('EventCardMapAGMComponent');

  constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private eventService: EventService,
    private userService: UserService,
    private activityCursorService: ActivityCursorService,
    public eventColorService: EventColorService) {
    super(changeDetectorRef);
  }


  ngOnInit() {
    if (!this.targetUserID || !this.event) {
      throw new Error('Component needs events and userID');
    }
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

    // // Get the new activityMapData
    // this.activitiesMapData = this.cacheNewData();
    // // No need to do anything if the base did not change (Event)
    // if (!simpleChanges.event) {
    //   return;
    // }
    // // If the event has changed then fit the bounds to show the new location
    // this.agmMap.triggerResize().then(() => {
    //   const googleMaps: GoogleMapsAPIWrapper = this.agmMap._mapsWrapper;
    //   googleMaps.fitBounds(this.getBounds());
    // });

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
    this.selectedActivities.forEach((activity) => {
      this.streamsSubscriptions.push(this.eventService.getStreamsByTypes(this.targetUserID, this.event.getID(), activity.getID(), [DataLatitudeDegrees.type, DataLongitudeDegrees.type])
        .subscribe((streams) => {
          // In case we are in the middle of a deletion of one of the lat/long streams or no streams
          if (!streams.length || streams.length !== 2) {
            // @todo improve
            const index = this.activitiesMapData.findIndex((activityMapData) => {
              return activityMapData.activity.getID() === activity.getID()
            });
            if (index !== -1) {
              this.activitiesMapData.splice(index, 1);
            }
            if (!this.activitiesMapData.length) {
              this.noMapData = true;
            }
            this.loaded();
            return;
          }

          // Start building map data
          const latData = streams[0].getStreamDataByTime(activity.startDate, true);
          const longData = streams[1].getStreamDataByTime(activity.startDate, true);

          // If no numeric data for any reason
          const positions = latData.reduce((latLongArray, value, index) => {
            latLongArray[index] = {
              latitudeDegrees: latData[index].value,
              longitudeDegrees: longData[index].value,
              time: longData[index].time
            };
            return latLongArray
          }, []).filter((position) => {
            // We filter due to stryd
            return position.latitudeDegrees !== 0 || position.longitudeDegrees !== 0
          });

          if (!positions.length) {
            this.loaded();
            return;
          }

          this.activitiesMapData.push({
            activity: activity,
            positions: positions,
            strokeColor: this.eventColorService.getActivityColor(this.event.getActivities(), activity),
            laps: activity.getLaps().reduce((laps, lap) => {
              // @todo gives back too big arrays should check the implementation of the activity method
              const positionData = activity.getSquashedPositionData(lap.startDate, lap.endDate, streams[0], streams[1]);
              if (!positionData.length || !this.showLaps) {
                return laps;
              }
              if (this.lapTypes.indexOf(lap.type) === -1) {
                return laps;
              }
              laps.push({
                lap: lap,
                lapPosition: {
                  latitudeDegrees: positionData[positionData.length - 1].latitudeDegrees,
                  longitudeDegrees: positionData[positionData.length - 1].longitudeDegrees
                }
              });
              return laps;
            }, [])
          });

          this.loaded();
          this.resizeMapToBounds();
        }))
    })
  }

  getBounds(): LatLngBoundsLiteral {
    const pointsWithPosition = this.activitiesMapData.reduce((pointsArray, activityData) => pointsArray.concat(activityData.positions), []);
    if (!pointsWithPosition.length) {
      return <LatLngBoundsLiteral>{
        east: 0,
        west: 0,
        north: 0,
        south: 0,
      };
    }
    const mostEast = pointsWithPosition.reduce((acc: { latitudeDegrees: number, longitudeDegrees: number }, latLongPair: { latitudeDegrees: number, longitudeDegrees: number }) => {
      return (acc.longitudeDegrees < latLongPair.longitudeDegrees) ? latLongPair : acc;
    });
    const mostWest = pointsWithPosition.reduce((acc: { latitudeDegrees: number, longitudeDegrees: number }, latLongPair: { latitudeDegrees: number, longitudeDegrees: number }) => {
      return (acc.longitudeDegrees > latLongPair.longitudeDegrees) ? latLongPair : acc;
    });

    const mostNorth = pointsWithPosition.reduce((acc: { latitudeDegrees: number, longitudeDegrees: number }, latLongPair: { latitudeDegrees: number, longitudeDegrees: number }) => {
      return (acc.latitudeDegrees < latLongPair.latitudeDegrees) ? latLongPair : acc;
    });

    const mostSouth = pointsWithPosition.reduce((acc: { latitudeDegrees: number, longitudeDegrees: number }, latLongPair: { latitudeDegrees: number, longitudeDegrees: number }) => {
      return (acc.latitudeDegrees > latLongPair.latitudeDegrees) ? latLongPair : acc;
    });

    return <LatLngBoundsLiteral>{
      east: mostEast.longitudeDegrees,
      west: mostWest.longitudeDegrees,
      north: mostNorth.latitudeDegrees,
      south: mostSouth.latitudeDegrees,
    };
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

  getFlagMarkerIcon(activity: ActivityInterface) {
    return {
      path: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z',
      fillColor: this.eventColorService.getActivityColor(this.event.getActivities(), activity),
      fillOpacity: 1,
      strokeColor: '#FFF',
      strokeWeight: 0.8,
      scale: 1.5,
      anchor: {x: 6, y: 24}
    }
  }

  getCursorMarkerIcon(activity: ActivityInterface) {
    return {
      path: 'M5 15H3v4c0 1.1.9 2 2 2h4v-2H5v-4zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zm0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zM12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
      fillColor: this.eventColorService.getActivityColor(this.event.getActivities(), activity),
      fillOpacity: 1,
      strokeColor: '#FFF',
      strokeWeight: 0.8,
      scale: 1,
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

  getStyles(mapTheme: MapThemes) {
    return mapStyles[mapTheme]
  }

  lineMouseMove(event: PolyMouseEvent, activityMapData: MapData) {
    const nearest = (new GeoLibAdapter()).findNearest({
      latitude: event.latLng.lat(),
      longitude: event.latLng.lng()
    }, activityMapData.positions.map(a => { return {latitude: a.latitudeDegrees, longitude: a.longitudeDegrees, time: a.time}}));

    if (!nearest) {
      return;
    }

    // debugger;
    this.activityCursorService.setCursor({
      activityID: activityMapData.activity.getID(),
      time: nearest.time,
    });
    this.activitiesCursors.set(activityMapData.activity.getID(), {
      latitudeDegrees: nearest.latitude,
      longitudeDegrees: nearest.longitude
    });
  }

  lineMouseOut(event: PolyMouseEvent, activityMapData: MapData) {
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
    this.resizeMapToBounds();
  }

  ngOnDestroy(): void {
    this.unSubscribeFromAll();
    this.streamsSubscriptions.forEach((streamsSubscription) => {
      streamsSubscription.unsubscribe()
    })
  }

  private unSubscribeFromAll() {
    this.streamsSubscriptions.forEach((streamsSubscription) => {
      streamsSubscription.unsubscribe()
    });
  }

  private resizeMapToBounds() {
    if (!this.agmMap) {
      return;
    }
    this.agmMap.triggerResize().then(() => {
      if (!this.agmMap) {
        return;
      }
      this.agmMap._mapsWrapper.fitBounds(this.getBounds())
    });
  }
}


export interface MapData {
  activity: ActivityInterface;
  positions: DataPositionInterface[];
  strokeColor: string;
  laps: {
    lap: LapInterface,
    lapPosition: DataPositionInterface,
    symbol: any,
  }[]
}
