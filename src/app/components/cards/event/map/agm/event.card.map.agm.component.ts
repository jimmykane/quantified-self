import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  OnChanges, OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import {AgmMap, LatLngBoundsLiteral, PolyMouseEvent} from '@agm/core';
import {AppEventColorService} from '../../../../../services/color/app.event.color.service';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {PointInterface} from 'quantified-self-lib/lib/points/point.interface';
import {LapInterface} from 'quantified-self-lib/lib/laps/lap.interface';
import {ControlPosition, MapTypeControlOptions, MapTypeId} from '@agm/core/services/google-maps-types';
import {Log} from 'ng2-logger/browser';
import {EventService} from '../../../../../services/app.event.service';
import {DataLatitudeDegrees} from 'quantified-self-lib/lib/data/data.latitude-degrees';
import {DataLongitudeDegrees} from 'quantified-self-lib/lib/data/data.longitude-degrees';
import {Subscription} from 'rxjs';

@Component({
  selector: 'app-event-card-map-agm',
  templateUrl: './event.card.map.agm.component.html',
  styleUrls: ['./event.card.map.agm.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventCardMapAGMComponent implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @ViewChild(AgmMap) agmMap;
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[];
  @Input() isVisible: boolean;
  @Input() showAutoLaps: boolean;
  @Input() showManualLaps: boolean;
  @Input() showData: boolean;
  @Input() showDataWarnings: boolean;


  private streamsSubscriptions: Subscription[] = [];
  public activitiesMapData: MapData[] = [];
  public openedLapMarkerInfoWindow: LapInterface;
  public openedActivityStartMarkerInfoWindow: ActivityInterface;
  public clickedPoint: PointInterface;
  public mapTypeControlOptions: MapTypeControlOptions = {
    // mapTypeIds: [MapTypeId],
    position: ControlPosition.TOP_RIGHT,
  };

  private logger = Log.create('EventCardMapAGMComponent');

  constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private eventService: EventService,
    public eventColorService: AppEventColorService) {
  }


  ngOnInit() {
  }

  ngAfterViewInit(): void {
  }


  ngOnChanges(simpleChanges) {
    // debugger
    // // If no operational changes return
    if ((simpleChanges.event
      || simpleChanges.selectedActivities)) {
      this.bindToNewData();
    }

    this.resizeMapToBounds();

    // if (simpleChanges.isVisible)

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
    this.activitiesMapData = [];
    this.unSubscribeFromAll();
    this.selectedActivities.forEach((activity) => {
      this.streamsSubscriptions.push(this.eventService.getStreamsByTypes(this.event.getID(), activity.getID(), [DataLatitudeDegrees.type, DataLongitudeDegrees.type])
        .subscribe((streams) => {
          // In case we are in the middle of a deletion of one of the lat/long streams or no streams
          if (!streams.length || streams.length !== 2) {
            this.activitiesMapData.splice(this.activitiesMapData.findIndex((activityMapData) => { return activityMapData.activity.getID() === activity.getID()}), 1);
            this.changeDetectorRef.detectChanges();
            return;
          }
          // Start building map data
          const latData = streams[0].getNumericData();
          const longData = streams[1].getNumericData();
          // debugger;
          this.activitiesMapData.push({
            activity: activity,
            positions: latData.reduce((latLongArray, value, index) => {
              latLongArray[index] = {
                latitude: latData[index],
                longitude: longData[index],
              };
              return latLongArray
            }, []),
          });
          // debugger;
          this.changeDetectorRef.detectChanges();
          this.resizeMapToBounds();
        }))
    })
  }

  // private cacheNewData(): MapData[] {
  //   const t0 = performance.now();
  //   const activitiesMapData = [];
  //   this.selectedActivities.forEach((activity) => {
  //     let activityPoints: PointInterface[];
  //     if (this.showData) {
  //       activityPoints = activity.getPointsInterpolated();
  //     } else {
  //       activityPoints = activity.getPoints()
  //     }
  //     activityPoints = activityPoints.filter((point) => point.getPosition());
  //     let lowNumberOfSatellitesPoints: PointInterface[] = [];
  //     if (this.showDataWarnings) {
  //       lowNumberOfSatellitesPoints = activityPoints.filter((point) => {
  //         const numberOfSatellitesData = point.getDataByType(DataNumberOfSatellites.type);
  //         if (!numberOfSatellitesData) {
  //           return false
  //         }
  //         return numberOfSatellitesData.getValue() < 7;
  //       });
  //     }
  //     // If the activity has no positions skip
  //     if (!activityPoints.length) {
  //       return;
  //     }
  //     // Check for laps with position
  //     const lapsWithPosition = activity.getLaps()
  //       .filter((lap) => {
  //         if (this.showAutoLaps && (lap.type === LapTypes.AutoLap || lap.type === LapTypes.Distance)) {
  //           return true;
  //         }
  //         if (this.showManualLaps && lap.type === LapTypes.Manual) {
  //           return true;
  //         }
  //         return false;
  //       })
  //       .reduce((lapsArray, lap) => {
  //         const lapPoints = this.event.getPointsWithPosition(lap.startDate, lap.endDate, [activity]);
  //         if (lapPoints.length) {
  //           lapsArray.push({
  //             lap: lap,
  //             lapPoints: lapPoints,
  //             lapEndPoint: lapPoints[lapPoints.length - 1],
  //           })
  //         }
  //         return lapsArray;
  //       }, []);
  //     // Create the object
  //     activitiesMapData.push({
  //       activity: activity,
  //       positions: activityPoints,
  //       lowNumberOfSatellitesPoints: lowNumberOfSatellitesPoints,
  //       activityStartPoint: activityPoints[0],
  //       lapsWithPosition: lapsWithPosition,
  //     });
  //   });
  //   const t1 = performance.now();
  //   this.logger.d(`Parsed activityMapData after ${t1 - t0}ms`);
  //   return activitiesMapData;
  // }

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
    const mostEast = pointsWithPosition.reduce((acc: { latitude: number, longitude: number }, latLongPair: { latitude: number, longitude: number }) => {
      return (acc.longitude < latLongPair.longitude) ? latLongPair : acc;
    });
    const mostWest = pointsWithPosition.reduce((acc: { latitude: number, longitude: number }, latLongPair: { latitude: number, longitude: number }) => {
      return (acc.longitude > latLongPair.longitude) ? latLongPair : acc;
    });

    const mostNorth = pointsWithPosition.reduce((acc: { latitude: number, longitude: number }, latLongPair: { latitude: number, longitude: number }) => {
      return (acc.latitude < latLongPair.latitude) ? latLongPair : acc;
    });

    const mostSouth = pointsWithPosition.reduce((acc: { latitude: number, longitude: number }, latLongPair: { latitude: number, longitude: number }) => {
      return (acc.latitude > latLongPair.latitude) ? latLongPair : acc;
    });

    return <LatLngBoundsLiteral>{
      east: mostEast.longitude,
      west: mostWest.longitude,
      north: mostNorth.latitude,
      south: mostSouth.latitude,
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

  lineClick(event: PolyMouseEvent, points: PointInterface[]) {
    // const nearestPoint = (new GeoLibAdapter()).getNearestPointToPosition({
    //   latitudeDegrees: event.latLng.lat(),
    //   longitudeDegrees: event.latLng.lng(),
    // }, positions);
    // if (nearestPoint) {
    //   this.clickedPoint = nearestPoint;
    // }
  }

  getMapValuesAsArray<K, V>(map: Map<K, V>): V[] {
    return Array.from(map.values());
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
    if (!this.agmMap){
      return;
    }
    this.agmMap.triggerResize().then(() => {
      if (!this.agmMap){
        return;
      }
      this.agmMap._mapsWrapper.fitBounds(this.getBounds())
    });
  }

}

export interface MapData {
  activity: ActivityInterface,
  positions: PointInterface[],
  // lowNumberOfSatellitesPoints: PointInterface[],
  // activityStartPoint: PointInterface,
  // lapsWithPosition: {
  //   lap: LapInterface,
  //   lapPoints: PointInterface[],
  //   lapEndPoint: PointInterface
  // }[]
}
