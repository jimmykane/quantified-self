import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  OnChanges, OnDestroy,
  OnInit, SimpleChange,
  ViewChild,
} from '@angular/core';
import {AgmMap, LatLngBoundsLiteral, PolyMouseEvent} from '@agm/core';
import {AppEventColorService} from '../../../../../services/color/app.event.color.service';
import {GoogleMapsAPIWrapper} from '@agm/core/services/google-maps-api-wrapper';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {PointInterface} from 'quantified-self-lib/lib/points/point.interface';
import {LapInterface} from 'quantified-self-lib/lib/laps/lap.interface';
import {DataPositionInterface} from 'quantified-self-lib/lib/data/data.position.interface';
import {ControlPosition, MapTypeControlOptions, MapTypeId} from '@agm/core/services/google-maps-types';
import {GeoLibAdapter} from 'quantified-self-lib/lib/geodesy/adapters/geolib.adapter';
import {DataNumberOfSatellites} from 'quantified-self-lib/lib/data/data.number-of-satellites';
import {Log} from 'ng2-logger/browser';
import {LapTypes} from 'quantified-self-lib/lib/laps/lap.types';
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
  public mapData: MapData[] = [];
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

    // // Get the new data
    // this.mapData = this.cacheNewData();
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
    this.mapData = [];
    this.unSubscribeFromAll();
    this.selectedActivities.forEach((activity) => {
      this.streamsSubscriptions.push(this.eventService.getStreams(this.event.getID(), activity.getID(), [DataLatitudeDegrees.type, DataLongitudeDegrees.type])
        .subscribe((streams) => {
          if (!streams.length) {
            return;
          }
          // Remove nulls
          const latData = streams[0].data.filter(data => !!data);
          const longData = streams[1].data.filter(data => !!data);
          // debugger;
          this.mapData.push({
            activity: activity,
            points: latData.reduce((latLongArray, value, index) => {
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

  private cacheNewData(): MapData[] {
    const t0 = performance.now();
    const mapData = [];
    this.selectedActivities.forEach((activity) => {
      let activityPoints: PointInterface[];
      if (this.showData) {
        activityPoints = activity.getPointsInterpolated();
      } else {
        activityPoints = activity.getPoints()
      }
      activityPoints = activityPoints.filter((point) => point.getPosition());
      let lowNumberOfSatellitesPoints: PointInterface[] = [];
      if (this.showDataWarnings) {
        lowNumberOfSatellitesPoints = activityPoints.filter((point) => {
          const numberOfSatellitesData = point.getDataByType(DataNumberOfSatellites.type);
          if (!numberOfSatellitesData) {
            return false
          }
          return numberOfSatellitesData.getValue() < 7;
        });
      }
      // If the activity has no points skip
      if (!activityPoints.length) {
        return;
      }
      // Check for laps with position
      const lapsWithPosition = activity.getLaps()
        .filter((lap) => {
          if (this.showAutoLaps && (lap.type === LapTypes.AutoLap || lap.type === LapTypes.Distance)) {
            return true;
          }
          if (this.showManualLaps && lap.type === LapTypes.Manual) {
            return true;
          }
          return false;
        })
        .reduce((lapsArray, lap) => {
          const lapPoints = this.event.getPointsWithPosition(lap.startDate, lap.endDate, [activity]);
          if (lapPoints.length) {
            lapsArray.push({
              lap: lap,
              lapPoints: lapPoints,
              lapEndPoint: lapPoints[lapPoints.length - 1],
            })
          }
          return lapsArray;
        }, []);
      // Create the object
      mapData.push({
        activity: activity,
        points: activityPoints,
        lowNumberOfSatellitesPoints: lowNumberOfSatellitesPoints,
        activityStartPoint: activityPoints[0],
        lapsWithPosition: lapsWithPosition,
      });
    });
    const t1 = performance.now();
    this.logger.d(`Parsed data after ${t1 - t0}ms`);
    return mapData;
  }

  getBounds(): LatLngBoundsLiteral {
    const pointsWithPosition = this.mapData.reduce((pointsArray, activityData) => pointsArray.concat(activityData.points), []);
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
    const nearestPoint = (new GeoLibAdapter()).getNearestPointToPosition({
      latitudeDegrees: event.latLng.lat(),
      longitudeDegrees: event.latLng.lng(),
    }, points);
    if (nearestPoint) {
      this.clickedPoint = nearestPoint;
    }
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
  points: { latitude: number, longitude: number }[], // @todo points here can cointain any datatype
  // lowNumberOfSatellitesPoints: PointInterface[],
  // activityStartPoint: PointInterface,
  // lapsWithPosition: {
  //   lap: LapInterface,
  //   lapPoints: PointInterface[],
  //   lapEndPoint: PointInterface
  // }[]
}
