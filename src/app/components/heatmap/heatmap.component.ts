import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import {AppAuthService} from '../../authentication/app.auth.service';
import {Router} from '@angular/router';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';
import * as L from 'leaflet';

@Component({
  selector: 'app-heatmap',
  templateUrl: './heatmap.component.html',
  styleUrls: ['./heatmap.component.css'],
})
export class HeatmapComponent {
  @ViewChild('mapDiv', {static: true}) mapDiv: ElementRef;

  private map;
  constructor(public authService: AppAuthService, public router: Router) {

  }

  ngAfterViewInit(): void {
    this.initMap()
  }

  private initMap(): void {
    this.map = L.map(this.mapDiv.nativeElement, {
      center: [ 39.8282, -98.5795 ],
      zoom: 3
    });
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });

    tiles.addTo(this.map);
  }
}
