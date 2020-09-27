import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnChanges,
  OnInit,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import {AppAuthService} from '../../authentication/app.auth.service';
import {Router} from '@angular/router';
import * as L from 'leaflet';
import 'leaflet-providers';
import { AppEventService } from '../../services/app.event.service';

@Component({
  selector: 'app-heatmap',
  templateUrl: './heatmap.component.html',
  styleUrls: ['./heatmap.component.css'],
})
export class HeatmapComponent implements AfterViewInit, OnInit {
  @ViewChild('mapDiv', {static: true}) mapDiv: ElementRef;

  private map;
  constructor(private eventService: AppEventService) {

  }

  ngOnInit(): void {
    this.eventService.getEventActivitiesAndSomeStreams()
  }

  ngAfterViewInit(): void {
    this.initMap()
  }

  private initMap(): void {
    this.map = L.map(this.mapDiv.nativeElement, {
      center:  [ 39.8282, -98.5795 ],
      zoom: 10,
      preferCanvas: true,
    });
    const tiles = L.tileLayer.provider('CartoDB.DarkMatter')

    tiles.addTo(this.map);
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
