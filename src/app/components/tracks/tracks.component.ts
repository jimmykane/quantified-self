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
import { LoggerService } from '../../services/logger.service';
import { TracksMapManager } from './tracks-map.manager'; // Imported Manager

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
    DateRanges.thisYear,
    DateRanges.all
  ]
  bufferProgress = new Subject<number>();
  totalProgress = new Subject<number>();

  public user!: AppUserInterface;

  private mapSignal = signal<any>(null); // Signal to hold map instance for reactive synchronization
  private tracksMapManager: TracksMapManager;
  private scrolled = false;

  private eventsSubscription: Subscription = new Subscription();
  private trackLoadingSubscription: Subscription = new Subscription();
  private currentStyleUrl: string | undefined;
  public manualStyleOverride: string | null = null; // Track manual style selection
  private terrainControl: any; // Using any to avoid forward reference issues if class is defined below
  private platformId!: object;

  private promiseTime!: number;
  private analyticsService = inject(AppAnalyticsService);
  private userSettingsQuery = inject(AppUserSettingsQueryService);
  private logger = inject(LoggerService);

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
  ) {
    this.tracksMapManager = new TracksMapManager(this.zone, this.eventColorService); // Initialize Manager

    const platformId = inject(PLATFORM_ID);
    this.platformId = platformId;
    effect(() => {
      const settings = this.userSettingsQuery.myTracksSettings();
      const map = this.mapSignal();
      // Guard: check for map presence and valid settings
      if (!map || !settings || settings.dateRange === undefined) return;

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

      const mapInstance = await this.mapboxLoader.createMap(this.mapDiv.nativeElement, {
        zoom: 1.5,
        center: [0, 20],
        style: initialStyleUrl // Pass user's preferred style directly
      });
      this.mapSignal.set(mapInstance);
      this.currentStyleUrl = initialStyleUrl; // Track so later checks don't re-apply

      const mapboxgl = await this.mapboxLoader.loadMapbox();
      this.tracksMapManager.setMap(mapInstance, mapboxgl);

      mapInstance.addControl(new mapboxgl.FullscreenControl(), 'bottom-right');

      // Standard Navigation Control for Zoom and Rotation (Pitch)
      const navControl = new mapboxgl.NavigationControl({
        visualizePitch: true,
        showCompass: true,
        showZoom: true
      });
      mapInstance.addControl(navControl, 'bottom-right');

      this.centerMapToStartingLocation(mapInstance);
      this.user = await this.authService.user$.pipe(take(1)).toPromise() as AppUserInterface;

      // Settings are now handled by the effect, but we need to ensure the first load happens 
      // if the effect ran before map was ready.

      // Restore terrain control (initialSettings already loaded above)
      // Initialize 3D state immediately for responsiveness and test compliance
      this.terrainControl = new TerrainControl(!!initialSettings?.is3D, (is3D) => {
        // Toggle map locally immediately for responsiveness
        this.tracksMapManager.toggleTerrain(is3D, true);

        if (is3D) {
          this.snackBar.open('Use Ctrl + Left Click (or Right Click) + Drag to rotate and tilt the map in 3D.', 'OK', {
            duration: 5000,
            verticalPosition: 'top'
          });
        }

        // Persist 3D setting via service
        this.userSettingsQuery.updateMyTracksSettings({ is3D });
      });
      mapInstance.addControl(this.terrainControl, 'bottom-right');
      this.tracksMapManager.setTerrainControl(this.terrainControl);

      // Restore terrain control (initialSettings already loaded above)
      // Initialize 3D state immediately for responsiveness and test compliance
      if (initialSettings?.is3D) {
        this.tracksMapManager.toggleTerrain(true, false);
      }


      // Trigger a manual check with current signal value (already have initialSettings)
      // Removed redundant scheduleSync call here as it's handled by the effect in constructor




      // ... (inside ngOnInit)

      // Subscribe to theme changes
      this.eventsSubscription.add(this.themeService.getAppTheme().subscribe(theme => {
        const map = this.mapSignal();
        if (!map) return;

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
    if (!this.mapSignal()) return;
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

      if (JSON.stringify(distinctSettings) === JSON.stringify(this.currentSettings)) {
        continue;
      }

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
    const map = this.mapSignal();
    if (!map) return;

    // Update local user state immediately to avoid desyncs during search() persisting stale settings
    if (this.user && this.user.settings) {
      this.user.settings.myTracksSettings = targetSettings;
    }

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
      this.mapSignal().setStyle(targetStyle, { diff: false });
      await this.waitForStyleLoad();

      this.tracksMapManager.clearAllTracks();
    }

    // 3. Terrain
    // If style changed, IS3D must be re-applied.
    // If IS3D changed, apply it.
    const is3D = !!targetSettings.is3D;
    // Note: toggleTerrain handles "add if missing".
    if (styleChanged || (this.currentSettings?.is3D !== is3D)) {
      this.tracksMapManager.toggleTerrain(is3D, true);
    }

    // 4. Data
    const dateChanged = this.currentSettings?.dateRange !== targetSettings.dateRange;
    const currentTypes = this.currentSettings?.activityTypes || [];
    const targetTypes = targetSettings.activityTypes || [];
    const typesChanged = JSON.stringify(currentTypes.sort()) !== JSON.stringify(targetTypes.sort());

    if (styleChanged || dateChanged || typesChanged || !this.currentSettings) {
      // We do NOT await tracks loading to prevent blocking the queue for too long,
      // but we do trigger it. The isLoading signal covers the STYLE switch (synchronous part).
      // If user wants tracks loading to block buttons, we should await it.
      // Given "monkey pressing", let's await it so we don't start next job until tracks request is fired?
      // No, loadTracks returns Promise<void> that awaits nothing crucial.
      // We call it.
      await this.loadTracksMapForUserByDateRange(this.user, this.mapSignal(), targetSettings.dateRange, targetSettings.activityTypes);
    }

    this.currentSettings = targetSettings;
  }

  private waitForStyleLoad(): Promise<void> {
    if (this.mapSignal().isStyleLoaded()) return Promise.resolve();
    return new Promise(resolve => this.mapSignal().once('style.load', () => resolve()));
  }

  public async search(event: { dateRange: DateRanges, activityTypes?: ActivityTypes[] }) {
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
    if (this.mapSignal()) {
      this.mapSignal().remove();
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
    const dates = getDatesForDateRange(dateRange, user.settings?.unitSettings?.startOfTheWeek || 1);
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

    this.logger.log(`[TracksComponent] Initializing fetch from event service for dateRange: ${DateRanges[dateRange]}, activityTypes: ${activityTypes?.[0] || 'all'}, promiseTime: ${promiseTime}`);

    this.trackLoadingSubscription = this.eventService.getEventsBy(user, where, 'startDate', true, 0)
      .pipe(
        debounceTime(300),
        take(1), // Fix: Avoid double emission (cache + server) and prevent memory leaks if subscription is not cleared
      )
      .subscribe(async (events) => {
        this.logger.log(`[TracksComponent] eventService.getEventsBy emitted ${events?.length || 0} events for promiseTime: ${promiseTime}`);
        try {
          events = events.filter((event) => event.getStat(DataStartPosition.type));
          if (!events || !events.length) {
            if (this.promiseTime !== promiseTime) {
              return;
            }
            this.tracksMapManager.clearAllTracks();
            this.clearProgressAndCloseBottomSheet();
            return;
          }

          const chuckArraySize = 15;
          const chunckedEvents: any[][] = events.reduce((all: any[][], one: any, i: number) => {
            const ch = Math.floor(i / chuckArraySize);
            all[ch] = ([] as any[]).concat((all[ch] || []), one);
            return all
          }, [])

          this.updateBufferProgress(100);

          if (this.promiseTime !== promiseTime) {
            return;
          }
          let count = 0;
          let addedTrackCount = 0;
          const allCoordinates: number[][] = [];

          for (const eventsChunk of chunckedEvents) {
            if (this.promiseTime !== promiseTime) {
              return;
            }

            const chunkCoordinates: number[][] = [];

            await Promise.all(eventsChunk.map(async (event: any) => {
              this.logger.log(`[TracksComponent] Fetching activities and streams for event: ${event.getID()}, promiseTime: ${promiseTime}`);
              event.addActivities(await this.eventService.getActivities(user, event.getID()).pipe(take(1)).toPromise())
              return this.eventService.attachStreamsToEventWithActivities(user, event, [
                DataLatitudeDegrees.type,
                DataLongitudeDegrees.type,
              ]).pipe(take(1)).toPromise()
                .then((fullEvent: any) => {
                  this.logger.log(`[TracksComponent] Attached streams for event: ${event.getID()}, promiseTime: ${promiseTime}`);
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
                        this.tracksMapManager.addTrackFromActivity(activity, coordinates);
                        addedTrackCount++;
                        coordinates.forEach((c: any) => chunkCoordinates.push(c));
                      }
                    })
                  count++;
                  this.updateTotalProgress(Math.ceil((count / events.length) * 100))
                })
            }))

            // Accumulate coordinates for final fitBounds
            chunkCoordinates.forEach(c => allCoordinates.push(c));

            if (count < events.length && chunkCoordinates.length > 0) {
              this.tracksMapManager.fitBoundsToCoordinates(chunkCoordinates);
            }
          }

          // Final fit bounds
          if (allCoordinates.length > 0) {
            this.tracksMapManager.fitBoundsToCoordinates(allCoordinates);
          }
          if (addedTrackCount === 0) {
            this.tracksMapManager.clearAllTracks();
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
    this.tracksMapManager.clearAllTracks();
  }

  private centerMapToStartingLocation(map: any) {
    if (isPlatformBrowser(this.platformId)) {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
          if (!this.scrolled) {
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

  private markScrolled(map: any) {
    map.off('movestart', this.onMoveStart);
    this.scrolled = true;
  }

  // Bound function to be able to remove listener
  private onMoveStart = () => {
    this.markScrolled(this.mapSignal());
  }

  private clearScroll(map: any) {
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
    return this.mapSignal() && this.mapSignal().isStyleLoaded();
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


}
