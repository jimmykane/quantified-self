import {
  AfterViewInit,
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
import { AppEventService } from '../../services/app.event.service';
import { take } from 'rxjs/operators';
import { Log } from 'ng2-logger/browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { DataLatitudeDegrees } from '@sports-alliance/sports-lib/lib/data/data.latitude-degrees';
import { DataLongitudeDegrees } from '@sports-alliance/sports-lib/lib/data/data.longitude-degrees';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { Observable, Subscription } from 'rxjs';
import { DateRanges } from '@sports-alliance/sports-lib/lib/users/settings/dashboard/user.dashboard.settings.interface';
import { getDatesForDateRange } from '../event-search/event-search.component';
import { DaysOfTheWeek } from '@sports-alliance/sports-lib/lib/users/settings/user.unit.settings.interface';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';
import { DataStartPosition } from '@sports-alliance/sports-lib/lib/data/data.start-position';
import { AngularFireStorage } from '@angular/fire/storage';
import WhereFilterOp = firebase.firestore.WhereFilterOp;

@Component({
  selector: 'app-heatmap',
  templateUrl: './heatmap.component.html',
  styleUrls: ['./heatmap.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeatmapComponent extends LoadingAbstractDirective implements AfterViewInit, OnInit {
  @ViewChild('mapDiv', {static: true}) mapDiv: ElementRef;
  public dataSubscription: Subscription;
  uploadPercent: Observable<number>;
  downloadURL: Observable<string>;
  private logger = Log.create('HeatmapComponent');
  private map: L.Map;
  private user: User;
  private positions: any[] = [];

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
    this.user = await this.authService.user.pipe(take(1)).toPromise();
    const dates = getDatesForDateRange(DateRanges.thisYear, DaysOfTheWeek.Monday);
    const where = []
    where.push({
      fieldPath: 'startDate',
      opStr: <WhereFilterOp>'>=',
      value: new Date('03-01-2020').getTime()
    });
    where.push({
      fieldPath: 'startDate',
      opStr: <WhereFilterOp>'<=', // Should remove mins from date
      value: dates.endDate.getTime()
    });
    this.dataSubscription = await this.eventService.getEventsBy(this.user, where, 'startDate', null, 500).subscribe(async (events) => {
      events = events.filter((event) => event.getStat(DataStartPosition.type));
      if (!events || !events.length) {
        this.loaded() // @todo fix add no data
        return;
      }
      for (const event of events) {
        this.eventService.getEventActivitiesAndSomeStreams(this.user,
          event.getID(),
          [DataLatitudeDegrees.type, DataLongitudeDegrees.type])
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
                const line = L.polyline(positionalData, lineOptions);
                this.positions.push({event: fullEvent, line: line})
                line.addTo(this.map);
                if (this.isLoading) {
                  this.loaded()
                  this.center(this.positions.map((p) => p.line))
                }
              })
          })
      }
    })
  }

  ngAfterViewInit(): void {
    this.initMap()
  }

  center(lines = []) {
    this.zone.runOutsideAngular(() => {
      this.map.fitBounds((L.featureGroup(lines)).getBounds(), {
        noMoveStart: false,
        animate: true,
        padding: [20, 20],
      });

    })
    // this.clearScroll();
    // this.map.addEventListener('movestart');
  }

  private initMap(): void {
    this.map = this.zone.runOutsideAngular(() => {
      const map = L.map(this.mapDiv.nativeElement, {
        // center: [39.8282, -98.5795],
        fadeAnimation: false,
        zoomAnimation: true,
        zoom: 10,
        preferCanvas: true,
        dragging: !L.Browser.mobile
      });
      const tiles = L.tileLayer.provider(AVAILABLE_THEMES[0])
      tiles.addTo(map);
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
