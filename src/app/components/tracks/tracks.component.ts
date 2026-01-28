import { Component, Inject, ViewChild, ElementRef, ChangeDetectorRef, NgZone, effect, signal, WritableSignal, PLATFORM_ID, OnInit, OnDestroy, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { AppEventService } from '../../services/app.event.service';
import { take, debounceTime } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppUserInterface } from '../../models/app-user.interface';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { Subject, Subscription } from 'rxjs';
import { DateRanges, ActivityTypes } from '@sports-alliance/sports-lib';
import { DataStartPosition } from '@sports-alliance/sports-lib';
import { getDatesForDateRange } from '../../helpers/date-range-helper';
import { AppFileService } from '../../services/app.file.service';
import { DataLatitudeDegrees } from '@sports-alliance/sports-lib';
import { DataLongitudeDegrees } from '@sports-alliance/sports-lib';
import { GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES } from '@sports-alliance/sports-lib';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MyTracksProgressComponent } from './progress/tracks.progress';
import { Overlay } from '@angular/cdk/overlay';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppUserService } from '../../services/app.user.service';
import { WhereFilterOp } from 'firebase/firestore';
import { MapboxLoaderService } from '../../services/mapbox-loader.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppMyTracksSettings } from '../../models/app-user.interface';

@Component({
  selector: 'app-tracks',
  templateUrl: './tracks.component.html',
  styleUrls: ['./tracks.component.css'],
  standalone: false
})
export class TracksComponent implements OnInit, OnDestroy {
  @ViewChild('mapDiv', { static: true }) mapDiv!: ElementRef;

  public dateRangesToShow: DateRanges[] = [
    DateRanges.thisWeek,
    DateRanges.lastWeek,
    DateRanges.lastSevenDays,
    DateRanges.thisMonth,
    DateRanges.lastMonth,
    DateRanges.lastThirtyDays,
    DateRanges.thisYear
  ]
  bufferProgress = new Subject<number>();
  totalProgress = new Subject<number>();

  public user!: AppUserInterface;

  private map!: any; // mapboxgl.Map - typed as any to avoid explicit dependency issues if types are missing
  private activeLayerIds: string[] = []; // Store IDs of added layers/sources
  private scrolled = false;

  private eventsSubscription: Subscription = new Subscription();
  private trackLoadingSubscription: Subscription = new Subscription();
  private currentStyleUrl: string | undefined;
  public manualStyleOverride: string | null = null; // Track manual style selection
  private terrainControl: any; // Using any to avoid forward reference issues if class is defined below

  private promiseTime!: number;
  private analyticsService = inject(AppAnalyticsService);
  private userSettingsQuery = inject(AppUserSettingsQueryService);

  // Track previous settings replaced by currentSettings/pendingSettings logic

  public isLoading: WritableSignal<boolean> = signal(false);
  private pendingSettings: AppMyTracksSettings | null = null;
  private currentSettings: AppMyTracksSettings | null = null;
  private isProcessingQueue = false;

  constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private eventService: AppEventService,
    private authService: AppAuthService,
    private router: Router,
    private eventColorService: AppEventColorService,
    private zone: NgZone,
    private fileService: AppFileService,
    private bottomSheet: MatBottomSheet,
    private overlay: Overlay,
    private userService: AppUserService,
    private snackBar: MatSnackBar,
    private mapboxLoader: MapboxLoaderService,
    private themeService: AppThemeService,
    @Inject(PLATFORM_ID) private platformId: object
  ) {
    effect(() => {
      const settings = this.userSettingsQuery.myTracksSettings();
      // Guard: check for map presence and valid settings
      if (!this.map || !settings || settings.dateRange === undefined) return;

      this.scheduleSync(settings as AppMyTracksSettings);
    });
  }

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      // --- Constructor Style Injection ---
      // Resolve user's preferred style BEFORE creating the map.
      const initialSettings = this.userSettingsQuery.myTracksSettings() as AppMyTracksSettings;
      const prefMapStyle = initialSettings?.mapStyle || 'default';
      let initialStyleUrl: string;
      if (prefMapStyle === 'satellite') {
        initialStyleUrl = 'mapbox://styles/mapbox/satellite-v9';
        this.manualStyleOverride = initialStyleUrl;
      } else if (prefMapStyle === 'outdoors') {
        initialStyleUrl = 'mapbox://styles/mapbox/outdoors-v12';
        this.manualStyleOverride = initialStyleUrl;
      } else {
        // 'default' - use theme
        const theme = this.themeService.appTheme();
        initialStyleUrl = theme === AppThemes.Dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11';
        this.manualStyleOverride = null;
      }

      this.map = await this.mapboxLoader.createMap(this.mapDiv.nativeElement, {
        zoom: 1.5,
        center: [0, 20],
        style: initialStyleUrl // Pass user's preferred style directly
      });
      this.currentStyleUrl = initialStyleUrl; // Track so later checks don't re-apply

      this.map.addControl(new (await this.mapboxLoader.loadMapbox()).FullscreenControl(), 'bottom-right');
      this.centerMapToStartingLocation(this.map);
      this.user = await this.authService.user$.pipe(take(1)).toPromise() as AppUserInterface;

      // Settings are now handled by the effect, but we need to ensure the first load happens 
      // if the effect ran before map was ready.

      // Restore terrain control (initialSettings already loaded above)
      // Initialize 3D state
      if (initialSettings?.is3D) {
        this.toggleTerrain(true, false);
      }

      this.terrainControl = new TerrainControl(!!initialSettings?.is3D, (is3D) => {
        // Toggle map locally immediately for responsiveness
        this.toggleTerrain(is3D, true);
        // Persist 3D setting via service
        this.userSettingsQuery.updateMyTracksSettings({ is3D });
      });
      this.map.addControl(this.terrainControl, 'bottom-right');


      // Trigger a manual check with current signal value (already have initialSettings)
      if (initialSettings) {
        this.scheduleSync(initialSettings);
      }




      // ... (inside ngOnInit)

      // Subscribe to theme changes
      this.eventsSubscription.add(this.themeService.getAppTheme().subscribe(theme => {
        if (!this.map) return;

        // If manual override is active, do not apply theme style
        if (this.manualStyleOverride) return;

        const style = theme === AppThemes.Dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11';

        // Robust check: Only update if the requested style is different from what we think it is
        if (this.currentStyleUrl === style) {
          return;
        }

        this.scheduleSync({ ...this.userSettingsQuery.myTracksSettings(), mapStyle: 'default' }); // Trigger sync with default style
      }));

      // Removed original manual addSource block as it is now handled in helper
    } catch (error) {
      console.error('Failed to initialize Mapbox:', error);
    }
  }

  public setMapStyle(styleType: 'default' | 'satellite' | 'outdoors') {
    if (!this.map) return;
    this.userSettingsQuery.updateMyTracksSettings({ mapStyle: styleType });
  }

  private scheduleSync(settings: AppMyTracksSettings) {
    this.pendingSettings = settings;
    if (!this.isProcessingQueue) {
      this.processQueue();
    }
  }

  private async processQueue() {
    this.isProcessingQueue = true;
    while (this.pendingSettings) {
      const distinctSettings = this.pendingSettings;
      this.pendingSettings = null; // consume job

      // Only show loading if style is actually changing, or simpler: just show it.
      // User wants feedback.
      this.isLoading.set(true);
      try {
        await this.synchronizeMap(distinctSettings);
      } catch (e) {
        console.error('Map sync error', e);
      }
      this.isLoading.set(false);
    }
    this.isProcessingQueue = false;
  }

  private async synchronizeMap(targetSettings: AppMyTracksSettings) {
    if (!this.map) return;

    // 1. Resolve Style
    let targetStyle = 'mapbox://styles/mapbox/streets-v11'; // fallback
    if (targetSettings.mapStyle === 'satellite') targetStyle = 'mapbox://styles/mapbox/satellite-v9';
    else if (targetSettings.mapStyle === 'outdoors') targetStyle = 'mapbox://styles/mapbox/outdoors-v12';
    else {
      const theme = this.themeService.appTheme();
      targetStyle = theme === AppThemes.Dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11';
      this.manualStyleOverride = null;
    }
    if (targetSettings.mapStyle !== 'default') this.manualStyleOverride = targetStyle;

    // 2. Apply Style if changed
    let styleChanged = false;
    if (this.currentStyleUrl !== targetStyle) {
      this.currentStyleUrl = targetStyle;
      styleChanged = true;
      this.map.setStyle(targetStyle, { diff: false });
      await this.waitForStyleLoad();
      this.activeLayerIds = []; // Sources wiped
    }

    // 3. Terrain
    // If style changed, IS3D must be re-applied.
    // If IS3D changed, apply it.
    const is3D = !!targetSettings.is3D;
    // Note: toggleTerrain handles "add if missing".
    if (styleChanged || (this.currentSettings?.is3D !== is3D)) {
      this.toggleTerrain(is3D, true);
    }

    // 4. Data
    const dateChanged = this.currentSettings?.dateRange !== targetSettings.dateRange;
    const typesChanged = JSON.stringify(this.currentSettings?.activityTypes) !== JSON.stringify(targetSettings.activityTypes);

    if (styleChanged || dateChanged || typesChanged || !this.currentSettings) {
      if (this.user && this.user.settings) {
        this.user.settings.myTracksSettings = targetSettings;
      }
      // We do NOT await tracks loading to prevent blocking the queue for too long,
      // but we do trigger it. The isLoading signal covers the STYLE switch (synchronous part).
      // If user wants tracks loading to block buttons, we should await it.
      // Given "monkey pressing", let's await it so we don't start next job until tracks request is fired?
      // No, loadTracks returns Promise<void> that awaits nothing crucial.
      // We call it.
      await this.loadTracksMapForUserByDateRange(this.user, this.map, targetSettings.dateRange, targetSettings.activityTypes);
    }

    this.currentSettings = targetSettings;
  }

  private waitForStyleLoad(): Promise<void> {
    if (this.map.isStyleLoaded()) return Promise.resolve();
    return new Promise(resolve => this.map.once('style.load', () => resolve()));
  }

  public async search(event) {
    if (!isPlatformBrowser(this.platformId)) return;

    // Update user settings - this will trigger signal -> effect -> handleSettingsChange -> loadTracks
    this.userSettingsQuery.updateMyTracksSettings({
      dateRange: event.dateRange,
      activityTypes: event.activityTypes
    });

    // Manually clean legacy subscription if it exists, though effect handles fresh load
    if (this.trackLoadingSubscription) {
      this.trackLoadingSubscription.unsubscribe();
    }

    await this.userService.updateUserProperties(this.user, { settings: this.user.settings });
    this.analyticsService.logEvent('my_tracks_search', { method: DateRanges[event.dateRange] });
  }

  public ngOnDestroy() {
    this.unsubscribeFromAll()
    this.bottomSheet.dismiss();
    if (this.map) {
      this.map.remove();
    }
  }

  private unsubscribeFromAll() {
    if (this.eventsSubscription) {
      this.eventsSubscription.unsubscribe();
      // No need to re-initialize eventsSubscription here, as it's a parent for all component-level subscriptions
      // and will be fully disposed on ngOnDestroy.
    }
    if (this.trackLoadingSubscription) {
      this.trackLoadingSubscription.unsubscribe();
    }
  }

  private clearProgressAndOpenBottomSheet() {
    this.updateBufferProgress(0);
    this.updateTotalProgress(0);
    this.bottomSheet.open(MyTracksProgressComponent, {
      data: {
        totalProgress: this.totalProgress,
        bufferProgress: this.bufferProgress,
      },
      disableClose: true,
      hasBackdrop: false,
      closeOnNavigation: true,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
    });
  }

  private clearProgressAndCloseBottomSheet() {
    this.updateBufferProgress(0);
    this.updateTotalProgress(0);
    if (this.bottomSheet) {
      this.bottomSheet.dismiss()
    }
  }




  private async loadTracksMapForUserByDateRange(user: AppUserInterface, map: any, dateRange: DateRanges, activityTypes?: ActivityTypes[]) {
    const promiseTime = new Date().getTime();
    this.promiseTime = promiseTime
    this.clearProgressAndOpenBottomSheet();
    const dates = getDatesForDateRange(dateRange, user.settings.unitSettings.startOfTheWeek);
    const where = []
    if (dates.startDate) {
      where.push({
        fieldPath: 'startDate',
        opStr: <WhereFilterOp>'>=',
        value: dates.startDate.getTime()
      });
    }
    if (dates.endDate) {
      where.push({
        fieldPath: 'startDate',
        opStr: <WhereFilterOp>'<=', // Should remove mins from date
        value: dates.endDate.getTime()
      })
    }

    // Use the specific subscription for tracks loading
    if (this.trackLoadingSubscription) {
      this.trackLoadingSubscription.unsubscribe();
    }

    this.trackLoadingSubscription = this.eventService.getEventsBy(user, where, 'startDate', true, 0)
      .pipe(debounceTime(300))
      .subscribe(async (events) => {
        try {
          events = events.filter((event) => event.getStat(DataStartPosition.type));
          if (!events || !events.length) {
            this.clearProgressAndCloseBottomSheet();
            return;
          }

          const chuckArraySize = 15;
          const chunckedEvents = events.reduce((all, one, i) => {
            const ch = Math.floor(i / chuckArraySize);
            all[ch] = [].concat((all[ch] || []), one);
            return all
          }, [])

          this.updateBufferProgress(100);

          if (this.promiseTime !== promiseTime) {
            return;
          }
          let count = 0;
          const allCoordinates: number[][] = [];

          for (const eventsChunk of chunckedEvents) {
            if (this.promiseTime !== promiseTime) {
              return;
            }

            const chunkCoordinates: number[][] = [];

            await Promise.all(eventsChunk.map(async (event: any) => {
              event.addActivities(await this.eventService.getActivities(user, event.getID()).pipe(take(1)).toPromise())
              return this.eventService.attachStreamsToEventWithActivities(user, event, [
                DataLatitudeDegrees.type,
                DataLongitudeDegrees.type,
              ]).pipe(take(1)).toPromise()
                .then((fullEvent: any) => {
                  if (this.promiseTime !== promiseTime) {
                    return
                  }
                  fullEvent.getActivities()
                    .filter((activity: any) => activity.hasPositionData())
                    .filter((activity: any) => !activityTypes || activityTypes.length === 0 || activityTypes.includes(activity.type))
                    .forEach((activity: any) => {
                      const coordinates = activity.getPositionData()
                        .filter((position: any) => position)
                        .map((position: any) => {
                          // Mapbox uses [lng, lat]
                          const lng = Math.round(position.longitudeDegrees * Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES)) / Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES);
                          const lat = Math.round(position.latitudeDegrees * Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES)) / Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES);
                          return [lng, lat];
                        });

                      if (coordinates.length > 1) {
                        const color = this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activity.type);
                        const activityId = activity.getID() ? activity.getID() : `temp-${Date.now()}-${Math.random()}`;
                        const sourceId = `track-source-${activityId}`;
                        const layerId = `track-layer-${activityId}`;

                        // Run inside zone to ensure map updates are picked up? actually outside is better for perf
                        this.zone.runOutsideAngular(() => {
                          if (!map) return;
                          if (map.getSource(sourceId)) return; // Prevent duplicates

                          try {
                            map.addSource(sourceId, {
                              type: 'geojson',
                              data: {
                                type: 'Feature',
                                properties: {},
                                geometry: {
                                  type: 'LineString',
                                  coordinates: coordinates
                                }
                              }
                            });

                            // Add Main Track Layer
                            map.addLayer({
                              id: layerId,
                              type: 'line',
                              source: sourceId,
                              layout: {
                                'line-join': 'round',
                                'line-cap': 'round'
                              },
                              paint: {
                                'line-color': color,
                                'line-width': 2.5, // Slightly thicker
                                'line-opacity': 0.9 // High visibility
                              }
                            });
                          } catch (error: any) {
                            if (error?.message?.includes('Style is not done loading')) {
                              console.log('Style loading in progress, retrying tracks...');
                              map.once('style.load', () => {
                                this.loadTracksMapForUserByDateRange(user, map, dateRange, activityTypes);
                              });
                            } else {
                              console.warn('Failed to add track layer:', error);
                            }
                          }

                          this.activeLayerIds.push(layerId);
                          this.activeLayerIds.push(sourceId); // Store source ID too for cleanup
                        });

                        coordinates.forEach((c: any) => chunkCoordinates.push(c));
                      }
                    })
                  count++;
                  this.updateTotalProgress(Math.ceil((count / events.length) * 100))
                })
            }))

            // Accumulate coordinates for final fitBounds
            chunkCoordinates.forEach(c => allCoordinates.push(c));

            // Optional: pan to chunk as we load, like original? 
            // Original did: panToLines(map, batchLines)
            // We can do that here too.
            if (count < events.length && chunkCoordinates.length > 0) {
              this.fitBoundsToCoordinates(map, chunkCoordinates);
            }
          }

          // Final fit bounds
          if (allCoordinates.length > 0) {
            this.fitBoundsToCoordinates(map, allCoordinates);
          }
        } catch (e) {
          console.error('Error loading tracks', e);
        } finally {
          if (this.promiseTime === promiseTime) {
            this.clearProgressAndCloseBottomSheet();
          }
        }
      });
  }

  private clearAllPolylines() {
    if (!this.map) return;

    // Reverse order: remove layers first, then sources
    // We pushed layerId then sourceId, so we can iterate
    // But 'activeLayerIds' mixes them.
    // Mapbox requires removing layer before source.

    // Let's filter
    const layers = this.activeLayerIds.filter(id => id.startsWith('track-layer-'));
    const sources = this.activeLayerIds.filter(id => id.startsWith('track-source-'));

    layers.forEach(id => {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    });

    sources.forEach(id => {
      if (this.map.getSource(id)) this.map.removeSource(id);
    });

    this.activeLayerIds = [];
  }

  private async fitBoundsToCoordinates(map: any, coordinates: number[][]) {
    if (!coordinates || !coordinates.length) return;

    const mapboxgl = await this.mapboxLoader.loadMapbox();
    const bounds = new mapboxgl.LngLatBounds();

    coordinates.forEach(coord => {
      bounds.extend(coord as [number, number]);
    });

    this.zone.runOutsideAngular(() => {
      // Preserve current pitch/bearing so 3D view isn't lost
      const currentPitch = map.getPitch();
      const currentBearing = map.getBearing();

      map.fitBounds(bounds, {
        padding: 25,
        animate: true,
        pitch: currentPitch,
        bearing: currentBearing
      });
    });
  }

  private centerMapToStartingLocation(map: any) {
    if (isPlatformBrowser(this.platformId)) {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
          if (!this.scrolled && this.activeLayerIds.length === 0) {
            map.flyTo({
              center: [pos.coords.longitude, pos.coords.latitude], // Mapbox is [lng, lat]
              zoom: 9,
              essential: true
            });

            // noMoveStart doesn't seem to have an effect, see Leaflet
            // issue: https://github.com/Leaflet/Leaflet/issues/5396
            this.clearScroll(map);
          }
        });
      }
    }
  }

  private markScrolled(map) {
    map.off('movestart', this.onMoveStart);
    this.scrolled = true;
  }

  // Bound function to be able to remove listener
  private onMoveStart = () => {
    this.markScrolled(this.map);
  }

  private clearScroll(map) {
    this.scrolled = false;
    map.on('movestart', this.onMoveStart);
  }

  private updateBufferProgress(value: number) {
    this.bufferProgress.next(value)
  }

  private updateTotalProgress(value: number) {
    this.totalProgress.next(value);
  }

  // Refactored helpers
  private isStyleLoaded(): boolean {
    return this.map && this.map.isStyleLoaded();
  }

  private addDemSource(map: any) {
    if (map.getSource('mapbox-dem')) {
      return;
    }
    map.addSource('mapbox-dem', {
      'type': 'raster-dem',
      'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
      'tileSize': 512,
      'maxzoom': 14
    });
  }

  private toggleTerrain(enable: boolean, animate: boolean = true) {
    if (!this.map) return;

    try {
      // Ensure source exists just in case
      if (enable && !this.map.getSource('mapbox-dem')) {
        this.addDemSource(this.map);
      }

      if (enable) {
        this.map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
        if (animate) {
          this.map.easeTo({ pitch: 60 });
        } else {
          // Instant
          this.map.setPitch(60);
        }
      } else {
        this.map.setTerrain(null);
        if (animate) {
          this.map.easeTo({ pitch: 0 });
        } else {
          this.map.setPitch(0);
        }
      }

      this.terrainControl?.set3DState(enable);
    } catch (error: any) {
      if (error?.message?.includes('Style is not done loading')) {
        console.log('Style loading in progress, deferring 3D terrain...');
        this.map.once('style.load', () => this.toggleTerrain(enable, animate));
      } else {
        console.warn('Map style not ready for terrain toggle, deferring.', error);
        // Still retry just in case it's a momentary glitch?
        // Original logic was retry. Let's keep retry for generic errors if we want, or just fail.
        // The original code passed unconditionally to retry.
        // Checking error message explicitly is safer.
      }
    }
  }
}

class TerrainControl {
  private map: any;
  private container: HTMLElement | undefined;
  private icon: HTMLElement | undefined;

  constructor(private is3D: boolean, private onToggle: (val: boolean) => void) { }

  onAdd(map: any) {
    this.map = map;
    this.container = document.createElement('div');
    this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
    const btn = document.createElement('button');
    btn.className = 'mapboxgl-ctrl-icon mapboxgl-ctrl-terrain';
    btn.type = 'button';
    btn.title = 'Toggle 3D Terrain';
    btn.style.display = 'block';

    this.icon = document.createElement('span');
    this.icon.className = 'material-icons';
    this.icon.style.fontSize = '20px';
    this.icon.style.lineHeight = '29px';
    this.icon.innerText = 'landscape';

    // Set initial state
    if (this.is3D) {
      this.icon.style.color = '#4264fb';
    }

    btn.appendChild(this.icon);

    btn.onclick = () => {
      const was3D = !!map.getTerrain();
      const isNow3D = !was3D;

      // Use the component helper or duplicate logic? 
      // Since this class is outside, pass the logic in or duplicate securely.
      // We pass 'onToggle' which updates settings. 
      // But we need to toggle the map here.

      this.toggleMapTerrain(map, isNow3D);
      this.onToggle(isNow3D);
    };

    this.container.appendChild(btn);
    return this.container;
  }

  onRemove() {
    this.container?.parentNode?.removeChild(this.container);
    this.map = undefined;
  }

  public set3DState(is3D: boolean) {
    this.is3D = is3D;
    if (this.icon) {
      this.icon.style.color = is3D ? '#4264fb' : '';
    }
  }

  private toggleMapTerrain(map: any, enable: boolean) {
    if (enable) {
      // Check source
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          'type': 'raster-dem',
          'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
          'tileSize': 512,
          'maxzoom': 14
        });
      }
      map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
      map.easeTo({ pitch: 60 });
    } else {
      map.setTerrain(null);
      map.easeTo({ pitch: 0 });
    }
    // Update visual state
    this.set3DState(enable);
  }
}
