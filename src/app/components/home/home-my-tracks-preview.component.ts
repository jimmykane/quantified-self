import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppThemeService } from '../../services/app.theme.service';
import { LoggerService } from '../../services/logger.service';
import { MapStyleService } from '../../services/map-style.service';
import type { MapboxStyleSynchronizer } from '../../services/map/mapbox-style-synchronizer';
import {
  MyTracksMapViewFactory,
  type MyTracksMapViewHandle,
} from '../shared/my-tracks-map-view/my-tracks-map-view.factory';
import {
  HOME_MY_TRACKS_PREVIEW_COORDINATES,
  HOME_MY_TRACKS_PREVIEW_TRACKS,
} from './home-my-tracks-preview.data';

@Component({
  selector: 'app-home-my-tracks-preview',
  standalone: true,
  templateUrl: './home-my-tracks-preview.component.html',
  styleUrls: ['./home-my-tracks-preview.component.scss'],
})
export class HomeMyTracksPreviewComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true }) private mapContainer!: ElementRef<HTMLDivElement>;

  readonly initializationFailed = signal(false);

  private readonly platformId = inject(PLATFORM_ID);
  private readonly themeService = inject(AppThemeService);
  private readonly mapStyleService = inject(MapStyleService);
  private readonly mapViewFactory = inject(MyTracksMapViewFactory);
  private readonly logger = inject(LoggerService);
  private readonly manager = this.mapViewFactory.createManager();
  private mapViewHandle: MyTracksMapViewHandle | null = null;
  private styleSynchronizer: MapboxStyleSynchronizer | null = null;

  constructor() {
    effect(() => {
      const theme = this.themeService.appTheme();
      this.manager.setIsDarkTheme(theme === AppThemes.Dark);
      this.manager.refreshTrackColors();
      this.styleSynchronizer?.update(this.mapStyleService.resolve('default', theme));
    });
  }

  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const theme = this.themeService.appTheme();
    const resolvedStyle = this.mapStyleService.resolve('default', theme);
    const mapOptions: any = {
      center: [11.39, 47.275],
      zoom: 10,
      style: resolvedStyle.styleUrl,
      cooperativeGestures: true,
      attributionControl: true,
    };
    if (this.mapStyleService.isStandard(resolvedStyle.styleUrl) && resolvedStyle.preset) {
      mapOptions.config = { basemap: { lightPreset: resolvedStyle.preset } };
    }

    try {
      this.mapViewHandle = await this.mapViewFactory.initialize(
        this.manager,
        this.mapContainer.nativeElement,
        mapOptions,
        { controlMode: 'preview' },
      );
      this.styleSynchronizer = this.mapStyleService.createSynchronizer(
        this.mapViewHandle.map,
        resolvedStyle,
      );
      this.manager.setMapStyle('default');
      this.manager.setIsDarkTheme(theme === AppThemes.Dark);
      this.manager.setTracksFromPrepared(HOME_MY_TRACKS_PREVIEW_TRACKS);
      this.manager.fitBoundsToCoordinates(HOME_MY_TRACKS_PREVIEW_COORDINATES, {
        padding: 36,
        animate: false,
      });
    } catch (error) {
      this.initializationFailed.set(true);
      this.logger.error('[HomeMyTracksPreviewComponent] Failed to initialize sample MyTracks map.', error);
    }
  }

  ngOnDestroy(): void {
    this.mapViewHandle?.destroy();
    this.mapViewHandle = null;
    this.styleSynchronizer = null;
  }
}
