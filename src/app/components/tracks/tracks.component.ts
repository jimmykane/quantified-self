import { ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, inject, Inject, PLATFORM_ID } from '@angular/core';
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
import { effect } from '@angular/core';
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

  private promiseTime!: number;
  private analyticsService = inject(AppAnalyticsService);
  private userSettingsQuery = inject(AppUserSettingsQueryService);

  // Track previous settings for diffing in effect
  private previousSettings: AppMyTracksSettings | undefined;

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
      if (!this.map || !settings) return;

      this.handleSettingsChange(settings);
    });
  }

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      this.map = await this.mapboxLoader.createMap(this.mapDiv.nativeElement, {
        zoom: 1.5,
        center: [0, 20]
      });

      this.map.addControl(new (await this.mapboxLoader.loadMapbox()).FullscreenControl(), 'bottom-right');
      this.centerMapToStartingLocation(this.map);
      this.user = await this.authService.user$.pipe(take(1)).toPromise() as AppUserInterface;

      // Settings are now handled by the effect, but we need to ensure the first load happens 
      // if the effect ran before map was ready.

      // Restore terrain control
      const initialSettings = this.userSettingsQuery.myTracksSettings() as AppMyTracksSettings;
      this.map.addControl(new TerrainControl(!!initialSettings?.is3D, (is3D) => {
        // Persist 3D setting via service
        this.userSettingsQuery.updateMyTracksSettings({ is3D });
      }), 'bottom-right');


      // Trigger a manual check with current signal value
      const currentSettings = this.userSettingsQuery.myTracksSettings() as AppMyTracksSettings;
      if (currentSettings) {
        this.handleSettingsChange(currentSettings);
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

        this.applyStyle(style);
      }));

      // Removed original manual addSource block as it is now handled in helper
    } catch (error) {
      console.error('Failed to initialize Mapbox:', error);
    }
  }

  public setMapStyle(styleType: 'default' | 'satellite' | 'outdoors') {
    if (!this.map) return;
    // Persist setting - this will trigger the signal -> effect -> handleSettingsChange -> applyStyle workflow.
    this.userSettingsQuery.updateMyTracksSettings({ mapStyle: styleType });
  }

  private applyStyle(style: string) {
    this.currentStyleUrl = style;
    this.map.setStyle(style);

    this.map.once('style.load', async () => {
      // Re-add Terrain Source
      this.addDemSource(this.map);

      // Clear internal state of "active layers" because map cleared them
      this.activeLayerIds = [];
      // Re-fetch/Re-draw tracks
      this.changeDetectorRef.detectChanges(); // Check if this helps
      if (this.user?.settings?.myTracksSettings) {
        await this.loadTracksMapForUserByDateRange(this.user, this.map, this.user.settings.myTracksSettings.dateRange, this.user.settings.myTracksSettings.activityTypes);
      }
    });
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
                          if (map.getSource(sourceId)) return; // Prevent duplicates

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
                              'line-width': 2, // Equivalent to leaflet Default weight
                              'line-opacity': 0.6 // Slightly higher opacity for visibility
                            }
                          });

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
  }

  private async handleSettingsChange(settings: AppMyTracksSettings) {
    // 1. Handle Terrain Control & State
    // Note: We need to ensure the control exists or update it. 
    // Since TerrainControl is a custom control added via new(), we can't easily update its state externally 
    // without keeping a reference.
    // However, for this refactor, let's focus on the map effect.
    // The TerrainControl itself updates the user setting, which updates the signal, which triggers this again.
    // Circular? No, because we check distinctUntilChanged in service and could check here too.

    // Better: Ensure we only add the control once (which we do in ngOnInit logic mostly, but we removed it).
    // Wait, I removed the control addition in ngOnInit. I need to restore it or add it here.
    // Adding controls in an effect is risky (duplicates). 
    // Let's add the control in ngOnInit ONCE, and detached from specific settings values if possible, 
    // OR manage it here carefully. 
    // actually, let's put the Control addition back to ngOnInit but just use a callback that updates service.

    // 2. Handle 3D
    if (this.previousSettings?.is3D !== settings.is3D) {
      this.toggleTerrain(!!settings.is3D, true);
    }

    // 3. Handle Map Style
    if (this.previousSettings?.mapStyle !== settings.mapStyle) {
      const styleType = settings.mapStyle || 'default';
      let styleUrl: string;
      if (styleType === 'default') {
        this.manualStyleOverride = null;
        const theme = this.themeService.appTheme();
        styleUrl = theme === AppThemes.Dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11';
      } else if (styleType === 'satellite') {
        styleUrl = 'mapbox://styles/mapbox/satellite-v9';
        this.manualStyleOverride = styleUrl;
      } else {
        styleUrl = 'mapbox://styles/mapbox/outdoors-v12';
        this.manualStyleOverride = styleUrl;
      }

      if (this.currentStyleUrl !== styleUrl) {
        this.applyStyle(styleUrl);
        // applyStyle triggers reload, so we might not need to explicit reload below if style changed
        // But applyStyle is async...
      }
    }

    // 4. Handle Data Load (DateRange or ActivityTypes)
    const dateRangeChanged = this.previousSettings?.dateRange !== settings.dateRange;
    // Simple array comparison for activity types
    const typesChanged = JSON.stringify(this.previousSettings?.activityTypes) !== JSON.stringify(settings.activityTypes);

    if (dateRangeChanged || typesChanged) {
      // Only reload if we are not already reloading from applyStyle? 
      // applyStyle reloads. 
      // If style changed, applyStyle runs.
      // If distinct checks pass, we are good.
      // But applyStyle uses `this.user.settings...`. We need to update that to use params or `settings` var.

      // Actually `applyStyle` calls `loadTracksMapForUserByDateRange` using `this.user.settings`. 
      // We should update `this.user.settings` to match the signal? 
      // Or pass arguments. 

      // Sync local user object settings to keep `this.user` consistent for other methods
      if (this.user && this.user.settings) {
        this.user.settings.myTracksSettings = settings;
      }

      await this.loadTracksMapForUserByDateRange(this.user, this.map, settings.dateRange || DateRanges.thisWeek, settings.activityTypes);
    }

    this.previousSettings = settings;
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
      if (this.icon) this.icon.style.color = '#4264fb';
    } else {
      map.setTerrain(null);
      map.easeTo({ pitch: 0 });
      if (this.icon) this.icon.style.color = '';
    }
  }
}
