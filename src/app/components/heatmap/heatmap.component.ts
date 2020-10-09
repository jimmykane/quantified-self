import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnInit,
  ViewChild
} from '@angular/core';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import 'leaflet-providers';
import 'leaflet-easybutton';
import { AppEventService } from '../../services/app.event.service';
import { subscribeOn, take } from 'rxjs/operators';
import { Log } from 'ng2-logger/browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { DataLatitudeDegrees } from '@sports-alliance/sports-lib/lib/data/data.latitude-degrees';
import { DataLongitudeDegrees } from '@sports-alliance/sports-lib/lib/data/data.longitude-degrees';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { animationFrameScheduler, Observable, Subscription } from 'rxjs';
import { DateRanges } from '@sports-alliance/sports-lib/lib/users/settings/dashboard/user.dashboard.settings.interface';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';
import { DataStartPosition } from '@sports-alliance/sports-lib/lib/data/data.start-position';
import { AngularFireStorage } from '@angular/fire/storage';
import { getDatesForDateRange } from '../../helpers/date-range-helper';
import WhereFilterOp = firebase.firestore.WhereFilterOp;

@Component({
  selector: 'app-heatmap',
  templateUrl: './heatmap.component.html',
  styleUrls: ['./heatmap.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeatmapComponent extends LoadingAbstractDirective implements OnInit {
  @ViewChild('mapDiv', {static: true}) mapDiv: ElementRef;
  public dataSubscription: Subscription;
  uploadPercent: Observable<number>;
  downloadURL: Observable<string>;
  private logger = Log.create('HeatmapComponent');
  private polyLines: L.Polyline[] = [];
  private viewAllButton: L.Control.EasyButton;
  private scrolled = false;

  constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private eventService: AppEventService,
    private authService: AppAuthService,
    private router: Router,
    private eventColorService: AppEventColorService,
    private zone: NgZone,
    private storage: AngularFireStorage,
    private snackBar: MatSnackBar) {
    super(changeDetectorRef)
  }

  async ngOnInit() {
    this.loading()
    const map = this.initMap()
    map.getContainer().focus = () => {
    } // Fix fullscreen switch
    this.centerMapToStartingLocation(map);
    const user = await this.authService.user.pipe(take(1)).toPromise();
    return this.bindToData(user, map, DateRanges.lastThirtyDays)
  }

  async bindToData(user: User, map: L.Map, dateRange: DateRanges) {
    const dates = getDatesForDateRange(dateRange, user.settings.unitSettings.startOfTheWeek);
    const where = []
    where.push({
      fieldPath: 'startDate',
      opStr: <WhereFilterOp>'>=',
      value: dates.startDate.getTime()
    });
    where.push({
      fieldPath: 'startDate',
      opStr: <WhereFilterOp>'<=', // Should remove mins from date
      value: dates.endDate.getTime()
    });
    let events = await this.eventService.getEventsBy(user, where, 'startDate', null, 500).pipe(take(1)).toPromise()
    events = events.filter((event) => event.getStat(DataStartPosition.type));
    if (!events || !events.length) {
      return;
    }
    for (const event of events) {
      this.eventService.getEventActivitiesAndSomeStreams(user,
        event.getID(),
        [DataLatitudeDegrees.type, DataLongitudeDegrees.type]).pipe(subscribeOn(animationFrameScheduler))
        .pipe(take(1)).toPromise().then((fullEvent) => {
        this.logger.info(`Promise completed`)
        const lineOptions = Object.assign({}, DEFAULT_OPTIONS.lineOptions);
        fullEvent.getActivities()
          .filter((activity) => activity.hasPositionData())
          .forEach((activity) => {
            const positionalData = activity.getPositionData().filter((position) => position).map((position) => {
              return {
                lat: position.latitudeDegrees,
                lng: position.longitudeDegrees
              }
            });
            lineOptions.color = this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activity.type)
            this.polyLines.push(L.polyline(positionalData, lineOptions).addTo(map));
            if (this.isLoading) {
              this.loaded()
              this.panToLines(map, this.polyLines)
            }
          })
      })
    }
  }

  panToLines(map: L.Map, lines: L.Polyline[]) {
    this.zone.runOutsideAngular(() => {
      map.fitBounds((L.featureGroup(lines)).getBounds(), {
        noMoveStart: false,
        animate: true,
        padding: [20, 20],
      });
    })
    if (!this.scrolled) {
      this.clearScroll(map);
    }
  }

  centerMapToStartingLocation(map: L.Map) {
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

  private initMap(): L.Map {
    return this.zone.runOutsideAngular(() => {
      const map = L.map(this.mapDiv.nativeElement, {
        center: [0, 0],
        fadeAnimation: true,
        zoomAnimation: true,
        zoom: 2,
        preferCanvas: false,
        dragging: !L.Browser.mobile
      });
      const tiles = L.tileLayer.provider(AVAILABLE_THEMES[0])
      tiles.addTo(map);
      this.viewAllButton = L.easyButton({
        type: 'animate',
        states: [{
          icon: `<img style="padding-top: 3px;width: 16px;height: 16px;"
                    src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2218%22%20height%3D%2218%22%20viewBox%3D%220%20018%2018%22%3E%0A%20%20%3Cpath%20fill%3D%22%23666%22%20d%3D%22M0%2C0v2v4h2V2h4V0H2H0z%20M16%2C0h-4v2h4v4h2V2V0H16z%20M16%2C16h-4v2h4h2v-2v-4h-2V16z%20M2%2C12H0v4v2h2h4v-2H2V12z%22%2F%3E%0A%3C%2Fsvg%3E%0A" alt="zoom in"/>`,
          stateName: 'default',
          title: 'Zoom to all tracks',
          onClick: () => {
            this.panToLines(map, this.polyLines);
          },
        }],
      }).addTo(map);
      return map
    })
  }
}

// Los Angeles is the center of the universe
const DEFAULT_OPTIONS = {
  theme: 'CartoDB.DarkMatter',
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
