import { ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, inject, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
// Leaflet imports removed for SSR safety - imported dynamically
import { AppEventService } from '../../services/app.event.service';
import { take } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { Subject, Subscription } from 'rxjs';
import { DateRanges } from '@sports-alliance/sports-lib';
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
    DateRanges.thisMonth,
    DateRanges.lastThirtyDays,
    DateRanges.thisYear,
    DateRanges.all,
  ]
  bufferProgress = new Subject<number>();
  totalProgress = new Subject<number>();

  public user!: User;



  private map!: any; // Typed as any to avoid importing L.Map in SSR
  private polyLines: any[] = []; // Typed as any to avoid importing L.Polyline in SSR
  // private viewAllButton: L.Control.EasyButton;
  private scrolled = false;

  private eventsSubscription!: Subscription;

  private promiseTime!: number;
  private analyticsService = inject(AppAnalyticsService);

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
    @Inject(PLATFORM_ID) private platformId: object
  ) {
  }

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Load Leaflet and plugins dynamically in browser only
    const leafletModule = await import('leaflet');
    const L = leafletModule.default || leafletModule;
    await import('leaflet-providers');
    await import('leaflet-easybutton');
    await import('leaflet-fullscreen');

    this.map = this.initMap(L)
    this.centerMapToStartingLocation(this.map);
    this.user = await this.authService.user$.pipe(take(1)).toPromise();
    if (!this.user.settings.myTracksSettings) {
      this.user.settings.myTracksSettings = {
        dateRange: DateRanges.thisWeek
      };
    }
    await this.loadTracksMapForUserByDateRange(L, this.user, this.map, this.user.settings.myTracksSettings.dateRange)
  }

  public async search(event) {
    if (!isPlatformBrowser(this.platformId)) return;
    const leafletModule = await import('leaflet');
    const L = leafletModule.default || leafletModule;
    this.unsubscribeFromAll();
    this.user.settings.myTracksSettings.dateRange = event.dateRange;
    await this.userService.updateUserProperties(this.user, { settings: this.user.settings });
    this.clearAllPolylines();
    this.centerMapToStartingLocation(this.map)
    await this.loadTracksMapForUserByDateRange(L, this.user, this.map, this.user.settings.myTracksSettings.dateRange)
    this.analyticsService.logEvent('my_tracks_search', { method: DateRanges[event.dateRange] });
  }

  public ngOnDestroy() {
    this.unsubscribeFromAll()
    this.bottomSheet.dismiss();
  }

  private unsubscribeFromAll() {
    if (this.eventsSubscription) {
      this.eventsSubscription.unsubscribe()
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

  private async loadTracksMapForUserByDateRange(L: any, user: User, map: any, dateRange: DateRanges) {
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

    this.eventsSubscription = this.eventService.getEventsBy(user, where, 'startDate', true, 0).subscribe(async (events) => {
      events = events.filter((event) => event.getStat(DataStartPosition.type));
      if (!events || !events.length) {
        return this.clearProgressAndCloseBottomSheet()
      }

      const chuckArraySize = 15;
      const chunckedEvents = events.reduce((all, one, i) => {
        const ch = Math.floor(i / chuckArraySize);
        all[ch] = [].concat((all[ch] || []), one);
        return all
      }, [])

      this.updateBufferProgress(100);

      if (this.promiseTime !== promiseTime) {
        return
      }
      let count = 0;
      for (const eventsChunk of chunckedEvents) {
        if (this.promiseTime !== promiseTime) {
          return
        }
        const batchLines = [];
        await Promise.all(eventsChunk.map(async (event) => {
          event.addActivities(await this.eventService.getActivities(user, event.getID()).pipe(take(1)).toPromise())
          return this.eventService.attachStreamsToEventWithActivities(user, event, [
            DataLatitudeDegrees.type,
            DataLongitudeDegrees.type,
          ]).pipe(take(1)).toPromise()
            .then((fullEvent) => {
              if (this.promiseTime !== promiseTime) {
                return
              }
              const lineOptions = Object.assign({}, DEFAULT_OPTIONS.lineOptions);
              fullEvent.getActivities()
                .filter((activity) => activity.hasPositionData())
                .forEach((activity) => {
                  const positionalData = activity.getPositionData().filter((position) => position).map((position) => {
                    return {
                      lat: Math.round(position.latitudeDegrees * Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES)) / Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES),
                      lng: Math.round(position.longitudeDegrees * Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES)) / Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES)
                    }
                  });
                  lineOptions.color = this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activity.type)
                  const line = L.polyline(positionalData, lineOptions).addTo(map)
                  this.polyLines.push(line);
                  batchLines.push(line)
                })
              count++;
              this.updateTotalProgress(Math.ceil((count / events.length) * 100))
            })
        }))
        if (count < events.length) {
          this.panToLines(map, batchLines)
        }
      }
      this.panToLines(map, this.polyLines)
    });
  }

  private clearAllPolylines() {
    this.polyLines.forEach(line => line.remove());
    this.polyLines = [];
  }

  private panToLines(map: any, lines: any[]) {
    if (!lines || !lines.length) {
      return;
    }
    // We need L here, but panToLines is called from loadTracksMapForUserByDateRange where we have L available? 
    // Wait, panToLines is called inside the subscription.
    // Ideally we pass L or use the dynamic import. 
    // To simplify and avoid changing signature everywhere significantly and since panToLines is called from context where L is loaded (browser),
    // we can import L dynamically here again (it's cached) OR pass it.
    // Let's pass it or assume global L if the library exposes it, but dynamic import is safer.
    // Actually, panToLines uses L.featureGroup.
    import('leaflet').then(leafletModule => {
      const L = leafletModule.default || leafletModule;
      this.zone.runOutsideAngular(() => {
        // Perhaps use panto with the lat,lng
        map.fitBounds((L.featureGroup(lines)).getBounds(), {
          noMoveStart: false,
          animate: true,
          padding: [25, 25],
        });
      })
    });
  }

  private centerMapToStartingLocation(map: any) {
    if (isPlatformBrowser(this.platformId)) {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
          if (!this.scrolled && this.polyLines.length === 0) {
            map.panTo([pos.coords.latitude, pos.coords.longitude], {
              noMoveStart: true,
              animate: false,
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
    map.removeEventListener('movestart', () => {
      this.markScrolled(map)
    });
    this.scrolled = true;
  }

  private clearScroll(map) {
    this.scrolled = false;
    map.addEventListener('movestart', () => {
      this.markScrolled(map)
    })
  }

  private initMap(L: any): any {
    return this.zone.runOutsideAngular(() => {
      const map = L.map(this.mapDiv.nativeElement, {
        center: [0, 0],
        fadeAnimation: true,
        zoomAnimation: true,
        zoom: 3.5,
        preferCanvas: false,
        fullscreenControl: true,
        // OR
        // fullscreenControl: {
        //   pseudoFullscreen: false // if true, fullscreen to page width and height
        // }
        // dragging: !L.Browser.mobile
      });

      map.getContainer().focus = () => {
      } // Fix fullscreen switch

      const tiles = L.tileLayer.provider(AVAILABLE_THEMES[0], { detectRetina: true })
      tiles.addTo(map);
      // L.easyButton({
      //   type: 'animate',
      //   states: [{
      //     icon: `<img style="padding-top: 3px;width: 16px;height: 16px;"
      //               src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2218%22%20height%3D%2218%22%20viewBox%3D%220%20018%2018%22%3E%0A%20%20%3Cpath%20fill%3D%22%23666%22%20d%3D%22M0%2C0v2v4h2V2h4V0H2H0z%20M16%2C0h-4v2h4v4h2V2V0H16z%20M16%2C16h-4v2h4h2v-2v-4h-2V16z%20M2%2C12H0v4v2h2h4v-2H2V12z%22%2F%3E%0A%3C%2Fsvg%3E%0A" alt="zoom in"/>`,
      //     stateName: 'default',
      //     title: 'Zoom to all tracks',
      //     onClick: () => {
      //       this.panToLines(map, this.polyLines);
      //     },
      //   }],
      // }).addTo(map);
      //
      // L.easyButton({
      //   type: 'animate',
      //   states: [{
      //     icon: 'fa-camera fa-lg',
      //     stateName: 'default',
      //     title: 'Export as png',
      //     onClick: () => {
      //       screenshot(map, 'svg');
      //     }
      //   }]
      // }).addTo(map);
      return map
    })
  }

  private updateBufferProgress(value: number) {
    this.bufferProgress.next(value)
  }

  private updateTotalProgress(value: number) {
    this.totalProgress.next(value)
  }
}

// Los Angeles is the center of the universe
const DEFAULT_OPTIONS = {
  theme: 'CartoDB.DarkMatter', // Should be based on app theme b&w
  lineOptions: {
    color: '#0CB1E8',
    weight: 1,
    opacity: 0.5,
    smoothFactor: 1,
    overrideExisting: true,
    detectColors: true,
  },
  markerOptions: {
    color: '#00FF00',
    weight: 3,
    radius: 5,
    opacity: 0.5
  }
};

const AVAILABLE_THEMES = [
  'CartoDB.DarkMatter',
  'CartoDB.DarkMatterNoLabels',
  'CartoDB.Positron',
  'CartoDB.PositronNoLabels',
  'Esri.WorldImagery',
  'OpenStreetMap.Mapnik',
  'OpenStreetMap.BlackAndWhite',
  'OpenTopoMap',
  'Stamen.Terrain',
  'Stamen.TerrainBackground',
  'Stamen.Toner',
  'Stamen.TonerLite',
  'Stamen.TonerBackground',
  'Stamen.Watercolor',
  'No map',
];
