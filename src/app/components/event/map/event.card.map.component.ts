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
  NgZone,
  SimpleChanges
} from '@angular/core';
import { GoogleMap, MapPolyline, MapMarker } from '@angular/google-maps';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { LapInterface } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../../services/app.event.service';
import { Subject, Subscription } from 'rxjs';
import { User } from '@sports-alliance/sports-lib';
import { LapTypes } from '@sports-alliance/sports-lib';
import { MapThemes } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../services/app.user.service';
import { AppActivityCursorService } from '../../../services/activity-cursor/app-activity-cursor.service';
import { GeoLibAdapter } from '@sports-alliance/sports-lib';
import { debounceTime, throttleTime } from 'rxjs/operators';
import { asyncScheduler } from 'rxjs';
import { MapAbstractDirective } from '../../map/map-abstract.directive';
import { DataLatitudeDegrees } from '@sports-alliance/sports-lib';
import { DataLongitudeDegrees } from '@sports-alliance/sports-lib';
import { environment } from '../../../../environments/environment';
import { LoggerService } from '../../../services/logger.service';

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
  public mapTypeId: google.maps.MapTypeId | string = 'roadmap';
  public activitiesCursors: Map<string, { latitudeDegrees: number, longitudeDegrees: number }> = new Map();

  // Map options
  public mapOptions: google.maps.MapOptions = {
    gestureHandling: 'none',
    scrollwheel: false,
    tilt: 45,
    controlSize: 32,
    disableDefaultUI: true,
    fullscreenControl: true,
    scaleControl: true,
    rotateControl: true,
    zoomControl: true,
    streetViewControl: true,
    mapTypeControl: true,
  };

  public mapCenter: google.maps.LatLngLiteral = { lat: 0, lng: 0 };
  public mapZoom = 12;

  private activitiesCursorSubscription: Subscription;
  private lineMouseMoveSubject: Subject<{ event: google.maps.MapMouseEvent, activityMapData: MapData }> = new Subject();
  private lineMouseMoveSubscription: Subscription;

  public apiLoaded = false;
  private processSequence = 0;
  private pendingFitBoundsTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private zone: NgZone,
    private changeDetectorRef: ChangeDetectorRef,
    private eventService: AppEventService,
    private userService: AppUserService,
    private activityCursorService: AppActivityCursorService,
    public eventColorService: AppEventColorService,
    protected logger: LoggerService) {
    super(changeDetectorRef, logger);
  }

  ngOnInit() {
    if (!this.targetUserID || !this.event) {
      throw new Error('Component needs events and userID');
    }
    this.loadGoogleMaps();
  }

  private loadGoogleMaps() {
    if (typeof google === 'object' && typeof google.maps === 'object') {
      this.apiLoaded = true;
      this.changeDetectorRef.markForCheck();
      // Apply theme styles if map is already ready roughly
      this.mapOptions = { ...this.mapOptions, styles: this.getStyles(this.theme) };
      return;
    }

    const scriptSrc = `https://maps.googleapis.com/maps/api/js?key=${environment.firebase.apiKey}&libraries=visualization`;
    if (document.querySelector(`script[src="${scriptSrc}"]`)) {
      const existingScript = document.querySelector(`script[src="${scriptSrc}"]`) as HTMLScriptElement;
      if (!existingScript.getAttribute('data-loaded')) {
        const originalOnLoad = existingScript.onload;
        existingScript.onload = (e) => {
          if (originalOnLoad) {
            (originalOnLoad as any)(e);
          }
          this.zone.run(() => {
            this.apiLoaded = true;
            this.mapOptions = { ...this.mapOptions, styles: this.getStyles(this.theme) };
            this.changeDetectorRef.markForCheck();
          });
        };
      } else {
        this.apiLoaded = true;
        this.mapOptions = { ...this.mapOptions, styles: this.getStyles(this.theme) };
        this.changeDetectorRef.markForCheck();
      }
      return;
    }

    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
    script.onload = () => {
      script.setAttribute('data-loaded', 'true');
      this.zone.run(() => {
        this.apiLoaded = true;
        this.mapOptions = { ...this.mapOptions, styles: this.getStyles(this.theme) };
        this.changeDetectorRef.markForCheck();
      });
    }
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
    if (simpleChanges.theme) {
      this.mapOptions = { ...this.mapOptions, styles: this.getStyles(this.theme) };
    }

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

  async onMapReady(map: google.maps.Map) {
    this.mapActivities(++this.processSequence);
  }

  openLapMarkerInfoWindow(lap) {
    this.openedLapMarkerInfoWindow = lap;
    this.openedActivityStartMarkerInfoWindow = void 0;
  }

  openActivityStartMarkerInfoWindow(activity) {
    this.openedActivityStartMarkerInfoWindow = activity;
    this.openedLapMarkerInfoWindow = void 0;
  }

  getMarkerOptions(activity: ActivityInterface, color: string): google.maps.MarkerOptions {
    return {
      icon: {
        path: 'M22-48h-44v43h16l6 5 6-5h16z',
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#FFF',
        strokeWeight: 0.5,
        scale: 0.5,
        labelOrigin: new google.maps.Point(0, -24)
      }
    };
  }

  getHomeMarkerOptions(activity: ActivityInterface, color: string): google.maps.MarkerOptions {
    return {
      icon: {
        path: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#FFF',
        strokeWeight: 0.8,
        scale: 1.2,
        anchor: new google.maps.Point(12, 12)
      }
    };
  }

  getFlagMarkerOptions(activity: ActivityInterface, color: string): google.maps.MarkerOptions {
    return {
      icon: {
        path: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z',
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#FFF',
        strokeWeight: 0.8,
        scale: 1,
        anchor: new google.maps.Point(6, 24)
      }
    };
  }

  getCursorMarkerOptions(activity: ActivityInterface, color: string): google.maps.MarkerOptions {
    return {
      icon: {
        path: 'M5 15H3v4c0 1.1.9 2 2 2h4v-2H5v-4zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zm0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zM12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#FFF',
        strokeWeight: 1,
        scale: 1.2,
        anchor: new google.maps.Point(12, 12)
      }
    };
  }

  getLapMarkerOptions(activity: ActivityInterface, color: string, lapIndex: number): google.maps.MarkerOptions {
    return {
      icon: {
        path: 'M22-48h-44v43h16l6 5 6-5h16z',
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#FFF',
        strokeWeight: 0.5,
        scale: 0.5,
        labelOrigin: new google.maps.Point(0, -24)
      },
      label: {
        color: 'white',
        fontSize: '14px',
        text: (lapIndex + 1).toString()
      },
      zIndex: lapIndex + 1
    };
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

  getMapValuesAsArray<K, V>(map: Map<K, V>): V[] {
    return Array.from(map.values());
  }

  async changeMapType(mapType: google.maps.MapTypeId) {
    if (!this.user) return;
    this.mapTypeId = mapType;
    this.user.settings.mapSettings.mapType = mapType as any;
    await this.userService.updateUserProperties(this.user, { settings: this.user.settings });
  }

  @HostListener('window:resize', ['$event.target.innerWidth'])
  onResize(width) {
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
      this.mapCenter = {
        lat: this.activitiesMapData[0].positions[0].latitudeDegrees,
        lng: this.activitiesMapData[0].positions[0].longitudeDegrees
      };
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
