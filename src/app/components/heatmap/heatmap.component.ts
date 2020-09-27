import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import 'leaflet-providers';
import { AppEventService } from '../../services/app.event.service';
import { take } from 'rxjs/operators';
import { Log } from 'ng2-logger/browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';
import { DataLatitudeDegrees } from '@sports-alliance/sports-lib/lib/data/data.latitude-degrees';
import { DataLongitudeDegrees } from '@sports-alliance/sports-lib/lib/data/data.longitude-degrees';

@Component({
  selector: 'app-heatmap',
  templateUrl: './heatmap.component.html',
  styleUrls: ['./heatmap.component.css'],
})
export class HeatmapComponent implements AfterViewInit, OnInit {
  @ViewChild('mapDiv', {static: true}) mapDiv: ElementRef;
  private logger = Log.create('HeatmapComponent');
  private map;
  private user: User;
  private events: EventInterface[]
  private positions: any[] = [];

  constructor(
    private eventService: AppEventService,
    private authService: AppAuthService,
    private router: Router,
    private snackBar: MatSnackBar) {
  }

  async ngOnInit() {
    const latngArray = []
    this.user = await this.authService.user.pipe(take(1)).toPromise();
    this.events = await this.eventService.getEventsBy(this.user).pipe(take(1)).toPromise();
    const lineOptions = Object.assign({}, DEFAULT_OPTIONS.lineOptions);
    for (const event of this.events) {
      const newEvent = await this.eventService.getEventActivitiesAndSomeStreams(this.user,
        event.getID(),
        [DataLatitudeDegrees.type, DataLongitudeDegrees.type])
        .pipe(take(1)).toPromise();
      newEvent.getActivities().filter((activity) => activity.hasPositionData()).forEach((activity) => {
        const positionalData = activity.getPositionData().filter((position) => position).map((position) =>  {
          return {
            lat: position.latitudeDegrees,
            lng: position.longitudeDegrees
          }
        });
        // debugger
        const line = L.polyline(positionalData, lineOptions);
        this.positions.push({event: newEvent, line: line})
        line.addTo(this.map);
      })

    }
    this.center()


      // this.tracks.push(Object.assign({line, visible: true}, track));

    //   if (lineOptions.detectColors) {
    //     if (/-(Hike|Walk)\.gpx/.test(track.filename)) {
    //       lineOptions.color = '#ffc0cb';
    //     } else if (/-Run\.gpx/.test(track.filename)) {
    //       lineOptions.color = '#ff0000';
    //     } else if (/-Ride\.gpx/.test(track.filename)) {
    //       lineOptions.color = '#00ffff';
    //     }
    //   }
    //

    //
  }

  ngAfterViewInit(): void {
    this.initMap()
  }

  private initMap(): void {
    this.map = L.map(this.mapDiv.nativeElement, {
      center: [39.8282, -98.5795],
      zoom: 10,
      preferCanvas: true,
    });
    const tiles = L.tileLayer.provider('CartoDB.DarkMatter')

    tiles.addTo(this.map);
  }


  center() {
    // If there are no tracks, then don't try to get the bounds, as there
    // would be an error
    if (this.positions.length === 0) {
      return;
    }

    // debugger
    let tracksAndImages = this.positions.map(p => p.line)
    this.map.fitBounds((L.featureGroup(tracksAndImages)).getBounds(), {
      noMoveStart: true,
      animate: false,
      padding: [20, 20],
    });

    // this.clearScroll();
    // this.map.addEventListener('movestart');
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
