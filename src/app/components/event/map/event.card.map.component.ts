import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  signal,
} from '@angular/core';
import { GoogleMap } from '@angular/google-maps';
import { throttleTime } from 'rxjs/operators';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { EventInterface, ActivityInterface, LapInterface, User, LapTypes, GeoLibAdapter, DataLatitudeDegrees, DataLongitudeDegrees } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../../services/app.event.service';
import { Subject, Subscription, asyncScheduler } from 'rxjs';
import { AppUserService } from '../../../services/app.user.service';
import { AppActivityCursorService } from '../../../services/activity-cursor/app-activity-cursor.service';
import { MapAbstractDirective } from '../../map/map-abstract.directive';
import { environment } from '../../../../environments/environment';
import { LoggerService } from '../../../services/logger.service';
import { GoogleMapsLoaderService } from '../../../services/google-maps-loader.service';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';

@Component({
  selector: 'app-event-card-map',
  templateUrl: './event.card.map.component.html',
  styleUrls: ['./event.card.map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventCardMapComponent extends MapAbstractDirective implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @ViewChild(GoogleMap) googleMap: GoogleMap;
  @Input() event: EventInterface;
  @Input() targetUserID: string;
  @Input() user: User;
  @Input() selectedActivities: ActivityInterface[];
  @Input() showLaps: boolean;
  @Input() showPoints: boolean;
  @Input() showArrows: boolean;
  @Input() strokeWidth: number;
  @Input() lapTypes: LapTypes[] = [];

  public activitiesMapData: MapData[] = [];
  public noMapData = false;
  public openedLapMarkerInfoWindow: LapInterface;
  public openedActivityStartMarkerInfoWindow: ActivityInterface;
  public mapTypeId = signal<google.maps.MapTypeId>('roadmap' as google.maps.MapTypeId);
  public activitiesCursors: Map<string, { latitudeDegrees: number, longitudeDegrees: number }> = new Map();
  public mapCenter = signal<google.maps.LatLngLiteral>({ lat: 0, lng: 0 });
  public mapZoom = signal(12);

  // Map options
  public get mapOptions(): google.maps.MapOptions {
    return {
      gestureHandling: 'cooperative',
      scrollwheel: true,
      controlSize: 32,
      disableDefaultUI: true,
      fullscreenControl: true,
      scaleControl: true,
      rotateControl: true,
      zoomControl: true,
      streetViewControl: true,
      mapTypeControl: true,
      mapId: environment.googleMapsMapId,
      colorScheme: this.mapColorScheme()
    };
  }

  private activitiesCursorSubscription: Subscription;
  private lineMouseMoveSubject: Subject<{ event: google.maps.MapMouseEvent, activityMapData: MapData }> = new Subject();
  private lineMouseMoveSubscription: Subscription;

  public apiLoaded = signal(false);
  private processSequence = 0;
  private pendingFitBoundsTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private zone: NgZone,
    private changeDetectorRef: ChangeDetectorRef,
    private eventService: AppEventService,
    private userService: AppUserService,
    private activityCursorService: AppActivityCursorService,
    public eventColorService: AppEventColorService,
    private mapsLoader: GoogleMapsLoaderService,
    private markerFactory: MarkerFactoryService,
    protected logger: LoggerService) {
    super(changeDetectorRef, logger);
  }

  async ngOnInit() {
    if (!this.targetUserID || !this.event) {
      throw new Error('Component needs events and userID');
    }
    // Load 'maps' library
    await this.mapsLoader.importLibrary('maps');
    await this.mapsLoader.importLibrary('marker');

    if (this.user?.settings?.mapSettings?.mapType) {
      this.mapTypeId.set(this.user.settings.mapSettings.mapType as unknown as google.maps.MapTypeId);
    }

    this.apiLoaded.set(true);
    this.changeDetectorRef.markForCheck();
  }

  ngAfterViewInit(): void {
    // Subscribe to cursor changes from chart
    this.activitiesCursorSubscription = this.activityCursorService.cursors.pipe(
      throttleTime(1000, asyncScheduler, { leading: true, trailing: true })
    ).subscribe((cursors) => {
      cursors.filter(cursor => cursor.byChart === true).forEach(cursor => {
        const cursorActivityMapData = this.activitiesMapData.find(amd => amd.activity.getID() === cursor.activityID);
        if (cursorActivityMapData && cursorActivityMapData.positions.length > 0) {
          // Use linear scan - more reliable than binary search for edge cases
          const position = cursorActivityMapData.positions.reduce((prev, curr) =>
            Math.abs(curr.time - cursor.time) < Math.abs(prev.time - cursor.time) ? curr : prev);
          if (position) {
            this.activitiesCursors.set(cursor.activityID, {
              latitudeDegrees: position.latitudeDegrees,
              longitudeDegrees: position.longitudeDegrees
            });
            if (this.googleMap?.googleMap) {
              this.googleMap.googleMap.panTo({
                lat: position.latitudeDegrees,
                lng: position.longitudeDegrees
              });
            }
          }
        }
      });
      this.changeDetectorRef.detectChanges();
    });

    this.lineMouseMoveSubscription = this.lineMouseMoveSubject.subscribe(value => {
      this.lineMouseMove(value.event, value.activityMapData);
    });
  }

  ngOnChanges(simpleChanges: SimpleChanges) {
    if (
      (simpleChanges.selectedActivities && !simpleChanges.selectedActivities.firstChange) ||
      (simpleChanges.showLaps && !simpleChanges.showLaps.firstChange) ||
      (simpleChanges.lapTypes && !simpleChanges.lapTypes.firstChange) ||
      (simpleChanges.showArrows && !simpleChanges.showArrows.firstChange) ||
      (simpleChanges.strokeWidth && !simpleChanges.strokeWidth.firstChange) ||
      (simpleChanges.showPoints && !simpleChanges.showPoints.firstChange)
    ) {
      this.mapActivities(++this.processSequence);
    }
  }

  async onMapReady(_map: google.maps.Map) {
    this.mapActivities(++this.processSequence);
  }

  openLapMarkerInfoWindow(lap: LapInterface) {
    this.openedLapMarkerInfoWindow = lap;
    this.openedActivityStartMarkerInfoWindow = void 0;
  }

  openActivityStartMarkerInfoWindow(activity: ActivityInterface) {
    this.openedActivityStartMarkerInfoWindow = activity;
    this.openedLapMarkerInfoWindow = void 0;
  }

  getMarkerOptions(_activity: ActivityInterface, color: string): google.maps.marker.AdvancedMarkerElementOptions {
    return {
      content: this.markerFactory.createPinMarker(color),
      gmpClickable: true
    };
  }

  getHomeMarkerOptions(_activity: ActivityInterface, color: string): google.maps.marker.AdvancedMarkerElementOptions {
    return {
      content: this.markerFactory.createHomeMarker(color),
      title: 'Start',
      zIndex: 100
    };
  }

  getFlagMarkerOptions(_activity: ActivityInterface, color: string): google.maps.marker.AdvancedMarkerElementOptions {
    return {
      content: this.markerFactory.createFlagMarker(color)
    };
  }

  getCursorMarkerOptions(_activity: ActivityInterface, color: string): google.maps.marker.AdvancedMarkerElementOptions {
    return {
      content: this.markerFactory.createCursorMarker(color),
      zIndex: 200
    };
  }

  getLapMarkerOptions(_activity: ActivityInterface, color: string, lapIndex: number): google.maps.marker.AdvancedMarkerElementOptions {
    return {
      content: this.markerFactory.createLapMarker(color, lapIndex),
      zIndex: lapIndex + 1
    };
  }

  pointMarkerContent(color: string): Node {
    return this.markerFactory.createPointMarker(color);
  }

  getPolylineOptions(activityMapData: MapData): google.maps.PolylineOptions {
    const options: google.maps.PolylineOptions = {
      strokeColor: activityMapData.strokeColor,
      strokeWeight: this.strokeWidth || 3,
      strokeOpacity: 1,
      clickable: true
    };

    if (this.showArrows) {
      options.icons = [{
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 2,
          strokeColor: '#FFF',
          strokeWeight: 1,
          fillColor: activityMapData.strokeColor,
          fillOpacity: 1
        },
        offset: '50%',
        repeat: '100px'
      }];
    }

    return options;
  }

  getPolylinePath(activityMapData: MapData): google.maps.LatLngLiteral[] {
    return activityMapData.positions.map(pos => ({
      lat: pos.latitudeDegrees,
      lng: pos.longitudeDegrees
    }));
  }

  onPolylineClick(event: google.maps.MapMouseEvent, activityMapData: MapData) {
    this.lineMouseMoveSubject.next({ event, activityMapData });
  }

  private async lineMouseMove(event: google.maps.MapMouseEvent, activityMapData: MapData) {
    if (!event.latLng) return;

    this.activitiesCursors.set(activityMapData.activity.getID(), {
      latitudeDegrees: event.latLng.lat(),
      longitudeDegrees: event.latLng.lng()
    });
    this.changeDetectorRef.detectChanges();

    const nearest = <{ latitude: number, longitude: number, time: number }>(new GeoLibAdapter()).findNearest({
      latitude: event.latLng.lat(),
      longitude: event.latLng.lng()
    }, activityMapData.positions.map(a => ({
      latitude: a.latitudeDegrees,
      longitude: a.longitudeDegrees,
      time: a.time
    })));

    if (!nearest) return;

    this.activityCursorService.setCursor({
      activityID: activityMapData.activity.getID(),
      time: nearest.time,
      byMap: true,
    });
  }

  getMapValuesAsArray<K, V>(_map: Map<K, V>): V[] {
    return Array.from(_map.values());
  }

  async changeMapType(mapType: google.maps.MapTypeId) {
    if (!this.user) return;
    this.mapTypeId.set(mapType);
    this.user.settings.mapSettings.mapType = mapType as any;
    await this.userService.updateUserProperties(this.user, { settings: this.user.settings });
  }

  @HostListener('window:resize')
  onResize() {
    this.fitBoundsToActivities();
  }

  ngOnDestroy(): void {
    this.unSubscribeFromAll();
    if (this.pendingFitBoundsTimeout) {
      clearTimeout(this.pendingFitBoundsTimeout);
      this.pendingFitBoundsTimeout = null;
    }
  }

  private mapActivities(seq: number) {
    if (seq !== this.processSequence) {
      this.logger.warn(`[EventCardMap] mapActivities aborted BEFORE starting (seq mismatch: ${seq} !== ${this.processSequence})`);
      return;
    }
    this.logger.log(`[EventCardMap] mapActivities started for ${this.selectedActivities.length} activities (seq: ${seq})`);
    this.loading();
    this.noMapData = false;
    this.activitiesMapData = [];

    if (!this.selectedActivities?.length) {
      this.noMapData = true;
      this.loaded();
      this.logger.log(`[EventCardMap] mapActivities stopped: no activities selected (seq: ${seq})`);
      return;
    }

    this.selectedActivities.forEach((activity) => {
      if (!activity.hasPositionData()) return;

      const positionData = activity.getSquashedPositionData();
      const positions = activity.generateTimeStream([DataLatitudeDegrees.type, DataLongitudeDegrees.type])
        .getData(true)
        .reduce((positionWithTimeArray: PositionWithTime[], time, index): PositionWithTime[] => {
          positionWithTimeArray.push({
            time: activity.startDate.getTime() + time * 1000,
            ...positionData[index]
          });
          return positionWithTimeArray;
        }, []);

      this.activitiesMapData.push({
        activity: activity,
        positions: positions,
        strokeColor: this.eventColorService.getActivityColor(this.event.getActivities(), activity),
        laps: activity.getLaps().reduce((laps, lap) => {
          const lapPositionData = activity.getSquashedPositionData(lap.startDate, lap.endDate);
          if (!lapPositionData.length || !this.showLaps) return laps;
          if (this.lapTypes.indexOf(lap.type) === -1) return laps;
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
    });

    this.loaded();
    this.logger.log(`[EventCardMap] mapActivities completed (seq: ${seq})`);

    // Set initial center if we have data
    if (this.activitiesMapData.length > 0 && this.activitiesMapData[0].positions.length > 0) {
      this.mapCenter.set({
        lat: this.activitiesMapData[0].positions[0].latitudeDegrees,
        lng: this.activitiesMapData[0].positions[0].longitudeDegrees
      });
    }

    // Fit bounds after a short delay to ensure map is ready and container has size
    // Cancel any pending fitBounds to prevent duplicate calls
    if (this.pendingFitBoundsTimeout) {
      clearTimeout(this.pendingFitBoundsTimeout);
    }
    this.pendingFitBoundsTimeout = setTimeout(() => {
      this.pendingFitBoundsTimeout = null;
      this.fitBoundsToActivities();
    }, 500);
  }

  private fitBoundsToActivities() {
    if (!this.googleMap?.googleMap || !this.activitiesMapData.length) {
      this.logger.log('[EventCardMapComponent] Skipping fitBounds. mapReady:', !!this.googleMap?.googleMap, 'dataLength:', this.activitiesMapData.length);
      return;
    }

    const allPositions = this.activitiesMapData.reduce((arr, data) => arr.concat(data.positions), []);
    this.logger.log('[EventCardMapComponent] fitBoundsToActivities called for', allPositions.length, 'total positions across', this.activitiesMapData.length, 'activities');

    if (allPositions.length === 0) return;

    const bounds = this.getBounds(allPositions);
    this.logger.log('[EventCardMapComponent] Computed bounds:', JSON.stringify(bounds));

    this.googleMap.googleMap.fitBounds(bounds);

    // Log final zoom after a short delay to see what Google decided
    setTimeout(() => {
      this.logger.log('[EventCardMapComponent] Final zoom after fitBounds:', this.googleMap.googleMap.getZoom());
    }, 200);
  }

  private unSubscribeFromAll() {
    if (this.activitiesCursorSubscription) {
      this.activitiesCursorSubscription.unsubscribe();
    }
    if (this.lineMouseMoveSubscription) {
      this.lineMouseMoveSubscription.unsubscribe();
    }
  }
}

export interface MapData {
  activity: ActivityInterface;
  positions: PositionWithTime[];
  strokeColor: string;
  laps: {
    lap: LapInterface,
    lapPosition: { latitudeDegrees: number, longitudeDegrees: number, time?: number },
    symbol?: any,
  }[]
}

export interface PositionWithTime {
  latitudeDegrees: number;
  longitudeDegrees: number;
  time: number;
}
