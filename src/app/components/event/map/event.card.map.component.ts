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
  computed,
  effect,
  untracked,
} from '@angular/core';
import { GoogleMap, MapInfoWindow, MapAdvancedMarker } from '@angular/google-maps';
import { throttleTime } from 'rxjs/operators';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { EventInterface, ActivityInterface, LapInterface, User, LapTypes, GeoLibAdapter, DataLatitudeDegrees, DataLongitudeDegrees, DataJumpEvent, DataEvent } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../../services/app.event.service';
import { Subject, Subscription, asyncScheduler } from 'rxjs';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
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
  @ViewChild(GoogleMap) googleMap!: GoogleMap;
  @Input() event!: EventInterface;
  @Input() targetUserID!: string;
  @Input() user!: User;
  @Input() selectedActivities!: ActivityInterface[];
  public get showLaps() { return this.userSettingsQuery.mapSettings()?.showLaps ?? true; }
  public set showLaps(value: boolean) { this.userSettingsQuery.updateMapSettings({ showLaps: value }); }

  public get showArrows() { return this.userSettingsQuery.mapSettings()?.showArrows ?? true; }
  public set showArrows(value: boolean) { this.userSettingsQuery.updateMapSettings({ showArrows: value }); }

  public get strokeWidth() { return this.userSettingsQuery.mapSettings()?.strokeWidth ?? 2; }
  public set strokeWidth(value: number) { this.userSettingsQuery.updateMapSettings({ strokeWidth: value }); }

  @Input() lapTypes: LapTypes[] = [];
  @Input() set mapType(type: google.maps.MapTypeId | string) {
    if (type) {
      this.mapTypeId.set(type as google.maps.MapTypeId);
    }
  }

  public activitiesMapData: MapData[] = [];
  public noMapData = false;
  @ViewChild(MapInfoWindow) infoWindow!: MapInfoWindow;
  public openedLapMarkerInfoWindow: LapInterface | undefined;
  public openedActivityStartMarkerInfoWindow: ActivityInterface | undefined;
  public openedJumpMarkerInfoWindow: DataJumpEvent | undefined;

  public mapTypeId = signal<google.maps.MapTypeId>('roadmap' as google.maps.MapTypeId);
  public activitiesCursors: Map<string, { latitudeDegrees: number, longitudeDegrees: number }> = new Map();
  public mapCenter = signal<google.maps.LatLngLiteral>({ lat: 0, lng: 0 }, {
    equal: (a, b) => a.lat === b.lat && a.lng === b.lng
  });
  public mapZoom = signal(12);

  // Map options
  public mapOptions = computed<google.maps.MapOptions>(() => ({
    controlSize: 32,
    disableDefaultUI: true,
    backgroundColor: 'transparent',
    fullscreenControl: true,
    scaleControl: true,
    rotateControl: true,
    zoomControl: true,
    streetViewControl: true,
    mapTypeControl: true,
    mapTypeControlOptions: {
      mapTypeIds: ['roadmap', 'hybrid', 'terrain']
    },
    mapId: environment.googleMapsMapId,
    colorScheme: this.mapColorScheme()
  }));

  private activitiesCursorSubscription: Subscription = new Subscription();
  private lineMouseMoveSubject: Subject<{ event: google.maps.MapMouseEvent, activityMapData: MapData }> = new Subject();
  private lineMouseMoveSubscription: Subscription = new Subscription();
  private nativeMap!: google.maps.Map;
  private mapListener!: google.maps.MapsEventListener;

  public apiLoaded = signal(false);
  private processSequence = 0;
  private pendingFitBoundsTimeout: ReturnType<typeof setTimeout> | null = null;

  public mapInstance = signal<google.maps.Map | undefined>(undefined);
  public isMapVisible = signal(true);
  private lastAppliedColorScheme: string | undefined;

  constructor(
    private zone: NgZone,
    private changeDetectorRef: ChangeDetectorRef,
    private eventService: AppEventService,
    private userSettingsQuery: AppUserSettingsQueryService,
    private activityCursorService: AppActivityCursorService,
    public eventColorService: AppEventColorService,
    private mapsLoader: GoogleMapsLoaderService,
    private markerFactory: MarkerFactoryService,
    protected logger: LoggerService) {
    super(changeDetectorRef, logger);

    // Re-initialize map on theme change
    effect(() => {
      const colorScheme = this.mapColorScheme();
      // Use untracked to avoid reacting to mapInstance changes
      const map = untracked(() => this.mapInstance());

      // Only re-initialize if the scheme actually changed AND we have an active map
      if (map && this.lastAppliedColorScheme !== colorScheme) {
        this.logger.info(`Theme changed to ${colorScheme} - Re-initializing map...`);

        // Update the guard immediately to prevent loops
        this.lastAppliedColorScheme = colorScheme;

        this.isMapVisible.set(false);
        this.changeDetectorRef.detectChanges();

        this.isMapVisible.set(true);
        this.changeDetectorRef.detectChanges();
      } else if (!this.lastAppliedColorScheme) {
        // Initial set
        this.lastAppliedColorScheme = colorScheme;
      }
    });
  }

  async ngOnInit() {
    if (!this.targetUserID || !this.event) {
      throw new Error('Component needs events and userID');
    }
    if (this.user?.settings?.mapSettings?.mapType) {
      this.mapTypeId.set(this.user.settings.mapSettings.mapType as unknown as google.maps.MapTypeId);
    }

    // Load 'maps' library
    await this.mapsLoader.importLibrary('maps');
    await this.mapsLoader.importLibrary('marker');

    this.apiLoaded.set(true);
    this.changeDetectorRef.markForCheck();
  }

  ngAfterViewInit(): void {
    // Subscribe to cursor changes from chart
    this.activitiesCursorSubscription.add(this.activityCursorService.cursors.pipe(
      throttleTime(2000, asyncScheduler, { leading: true, trailing: true })
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
    }));

    this.lineMouseMoveSubscription.add(this.lineMouseMoveSubject.subscribe(value => {
      this.lineMouseMove(value.event, value.activityMapData);
    }));
  }

  ngOnChanges(simpleChanges: SimpleChanges) {
    if (
      (simpleChanges.selectedActivities && !simpleChanges.selectedActivities.firstChange) ||
      (simpleChanges.showLaps && !simpleChanges.showLaps.firstChange) ||
      (simpleChanges.lapTypes && !simpleChanges.lapTypes.firstChange) ||
      (simpleChanges.showArrows && !simpleChanges.showArrows.firstChange) ||
      (simpleChanges.strokeWidth && !simpleChanges.strokeWidth.firstChange) ||
      (simpleChanges.strokeWidth && !simpleChanges.strokeWidth.firstChange)
    ) {
      // Only re-fit bounds if the selected activities changed
      const shouldFitBounds = !!simpleChanges.selectedActivities;
      this.mapActivities(++this.processSequence, shouldFitBounds);
    }
  }

  onZoomChanged() {
    if (this.googleMap) {
      const newZoom = this.googleMap.getZoom();
      if (newZoom !== undefined && newZoom !== this.mapZoom()) {
        this.mapZoom.set(newZoom);
      }
    }
  }

  onCenterChanged() {
    if (this.googleMap) {
      const center = this.googleMap.getCenter();
      if (center) {
        const newCenter = { lat: center.lat(), lng: center.lng() };
        const currentCenter = this.mapCenter();
        if (newCenter.lat !== currentCenter.lat || newCenter.lng !== currentCenter.lng) {
          this.mapCenter.set(newCenter);
        }
      }
    }
  }

  onShowLapsChange(value: boolean) {
    this.showLaps = value; // Triggers setter -> updates service
    if (this.nativeMap) {
      this.mapActivities(++this.processSequence, false);
      this.changeDetectorRef.markForCheck();
    }
  }

  onShowArrowsChange(value: boolean) {
    this.logger.info('onShowArrowsChange', value);
    this.showArrows = value; // Triggers setter -> updates service
    if (this.nativeMap) {
      this.mapActivities(++this.processSequence, false);
      this.changeDetectorRef.markForCheck();
    }
  }

  async onMapReady(map: google.maps.Map) {
    this.logger.info('onMapReady called', map);
    this.nativeMap = map;
    this.mapInstance.set(map);
    this.mapActivities(++this.processSequence);

    // Store listener reference for cleanup if needed
    this.nativeMap.addListener('click', (_e: google.maps.MapMouseEvent) => {
      // Map click handling - no debug logging
    });

    // Add native listener for map type changes from Google controls
    if (this.mapListener) {
      this.mapListener.remove();
    }
    this.mapListener = this.nativeMap.addListener('maptypeid_changed', () => {
      const newType = this.nativeMap.getMapTypeId();
      // Only trigger change if the type is actually different from what's in user settings
      // to avoid infinite loops between signal updates and native events.
      if (this.user?.settings?.mapSettings?.mapType?.toString() !== newType?.toString()) {
        this.changeMapType(newType as google.maps.MapTypeId);
      }
    });
  }

  openLapMarkerInfoWindow(lap: LapInterface) {
    this.openedLapMarkerInfoWindow = lap;
    this.openedActivityStartMarkerInfoWindow = void 0;
    this.openedJumpMarkerInfoWindow = void 0;
  }

  openActivityStartMarkerInfoWindow(activity: ActivityInterface) {
    this.openedActivityStartMarkerInfoWindow = activity;
    this.openedLapMarkerInfoWindow = void 0;
    this.openedJumpMarkerInfoWindow = void 0;
  }

  openJumpMarkerInfoWindow(jump: DataJumpEvent, marker: MapAdvancedMarker) {
    this.zone.run(() => {
      this.openedJumpMarkerInfoWindow = jump;
      this.openedLapMarkerInfoWindow = void 0;
      this.openedActivityStartMarkerInfoWindow = void 0;
      this.infoWindow.open(marker);
      this.changeDetectorRef.markForCheck();
    });
  }

  onMapClick(_event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) {
    // Map click handler - available for future use
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

  getJumpMarkerOptions(jump: DataJumpEvent, color: string): google.maps.marker.AdvancedMarkerElementOptions {
    const data = jump.jumpData;
    const format = (v: number | undefined) => v !== undefined ? Math.round(v * 10) / 10 : '-';
    const stats = [
      `Distance: ${format(data.distance.getValue())} ${data.distance.getDisplayUnit()}`,
      `Height: ${data.height ? `${format(data.height.getValue())} ${data.height.getDisplayUnit()}` : '-'}`,
      `Score: ${format(data.score.getValue())}`,
      `Hang Time: ${data.hang_time ? `${format(data.hang_time.getValue())}` : '-'}`,
      `Speed: ${data.speed ? `${format(data.speed.getValue())} ${data.speed.getDisplayUnit()}` : '-'}`,
      `Rotations: ${data.rotations ? `${format(data.rotations.getValue())}` : '-'}`
    ].join('\n');

    const options = {
      content: this.markerFactory.createJumpMarker(color),
      title: `Jump Stats:\n${stats}`,
      zIndex: 150,
      gmpClickable: true
    };
    return options;
  }

  getPolylineOptions(activityMapData: MapData): google.maps.PolylineOptions {
    const options: google.maps.PolylineOptions = {
      strokeColor: activityMapData.strokeColor,
      strokeWeight: this.strokeWidth || 3,
      strokeOpacity: 1,
      clickable: true,
      icons: this.showArrows ? [{
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
      }] : []
    };

    if (this.showArrows) {
      this.logger.info('Adding arrows to polyline options');
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
    if (!this.user || this.user.settings?.mapSettings?.mapType?.toString() === mapType?.toString()) return;
    this.mapTypeId.set(mapType);

    // Safe persist via service
    this.userSettingsQuery.updateMapSettings({ mapType: mapType as any });
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

  private mapActivities(sequence: number, shouldFitBounds = true) {
    if (this.processSequence !== sequence) {
      return;
    }
    this.loading();
    this.noMapData = false;
    this.activitiesMapData = [];

    if (!this.selectedActivities?.length) {
      this.noMapData = true;
      this.loaded();
      return;
    }

    this.selectedActivities.forEach((activity) => {
      if (!activity.hasPositionData()) return;

      const positionData = activity.getSquashedPositionData();
      const positions = activity.generateTimeStream([DataLatitudeDegrees.type, DataLongitudeDegrees.type])
        .getData(true)
        .reduce<PositionWithTime[]>((positionWithTimeArray, time, index) => {
          const pos = positionData[index];
          if (pos && pos.latitudeDegrees !== undefined && pos.longitudeDegrees !== undefined && time !== null) {
            positionWithTimeArray.push({
              time: activity.startDate.getTime() + time * 1000,
              latitudeDegrees: pos.latitudeDegrees,
              longitudeDegrees: pos.longitudeDegrees
            });
          }
          return positionWithTimeArray;
        }, []);

      this.activitiesMapData.push({
        activity: activity,
        positions: positions,
        strokeColor: this.eventColorService.getActivityColor(this.event.getActivities(), activity),
        laps: activity.getLaps().reduce<any[]>((laps, lap) => {
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
        }, []),
        jumps: (activity.getAllEvents() || []).reduce<any[]>((jumps, event: DataEvent) => {
          if (event instanceof DataJumpEvent && event.jumpData.position_lat && event.jumpData.position_long) {
            jumps.push({
              event: event,
              position: {
                latitudeDegrees: event.jumpData.position_lat.getValue(),
                longitudeDegrees: event.jumpData.position_long.getValue()
              }
            });
          }
          return jumps;
        }, [])
      });
    });
    this.loaded();

    if (shouldFitBounds) {
      // Set initial center if we have data (only on initial load or activity changes)
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
  }

  private fitBoundsToActivities() {
    if (!this.googleMap?.googleMap || !this.activitiesMapData.length) {
      return;
    }

    const allPositions = this.activitiesMapData.reduce<PositionWithTime[]>((arr, data) => arr.concat(data.positions), []);
    if (allPositions.length === 0) return;

    const bounds = this.getBounds(allPositions);
    this.googleMap.googleMap.fitBounds(bounds);
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
  }[];
  jumps: {
    event: DataJumpEvent,
    position: { latitudeDegrees: number, longitudeDegrees: number }
  }[];
}

export interface PositionWithTime {
  latitudeDegrees: number;
  longitudeDegrees: number;
  time: number;
}
