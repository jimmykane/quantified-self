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
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppThemeService } from '../../services/app.theme.service';
import { LoggerService } from '../../services/logger.service';
import { MapStyleService } from '../../services/map-style.service';
import type { MapboxStyleSynchronizer } from '../../services/map/mapbox-style-synchronizer';
import type { MapOptions } from 'mapbox-gl';
import {
  MyTracksMapViewFactory,
  type MyTracksMapViewHandle,
} from '../shared/my-tracks-map-view/my-tracks-map-view.factory';
import { HOME_MY_TRACKS_PREVIEW_TRACKS } from './home-my-tracks-preview.data';

@Component({
  selector: 'app-home-my-tracks-preview',
  standalone: true,
  templateUrl: './home-my-tracks-preview.component.html',
  styleUrls: ['./home-my-tracks-preview.component.scss'],
})
export class HomeMyTracksPreviewComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true }) private mapContainer!: ElementRef<HTMLDivElement>;

  readonly initializationFailed = signal(false);
  readonly selectedPreviewIndex = signal(2);
  readonly previewOptions = Object.freeze([
    { label: 'Open water', accessibleLabel: 'Show open-water swimming activity' },
    { label: 'Trail run', accessibleLabel: 'Show trail-running activity' },
    { label: 'MTB', accessibleLabel: 'Show mountain-biking activity' },
  ]);

  private readonly platformId = inject(PLATFORM_ID);
  private readonly hapticsService = inject(AppHapticsService);
  private readonly themeService = inject(AppThemeService);
  private readonly mapStyleService = inject(MapStyleService);
  private readonly mapViewFactory = inject(MyTracksMapViewFactory);
  private readonly logger = inject(LoggerService);
  private readonly manager = this.mapViewFactory.createManager();
  private mapViewHandle: MyTracksMapViewHandle | null = null;
  private styleSynchronizer: MapboxStyleSynchronizer | null = null;
  private destroyed = false;

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
    const mapOptions: Omit<MapOptions, 'container'> = {
      center: [20.82, 39.42],
      zoom: 8.5,
      style: resolvedStyle.styleUrl,
      cooperativeGestures: true,
      attributionControl: true,
    };
    if (this.mapStyleService.isStandard(resolvedStyle.styleUrl) && resolvedStyle.preset) {
      mapOptions.config = { basemap: { lightPreset: resolvedStyle.preset } };
    }

    try {
      const mapViewHandle = await this.mapViewFactory.initialize(
        this.manager,
        this.mapContainer.nativeElement,
        mapOptions,
        { controlMode: 'preview' },
      );
      if (this.destroyed) {
        mapViewHandle.destroy();
        return;
      }

      this.mapViewHandle = mapViewHandle;
      this.styleSynchronizer = this.mapStyleService.createSynchronizer(
        mapViewHandle.map,
        resolvedStyle,
      );
      const currentTheme = this.themeService.appTheme();
      this.manager.setMapStyle('default');
      this.manager.setIsDarkTheme(currentTheme === AppThemes.Dark);
      this.styleSynchronizer.update(this.mapStyleService.resolve('default', currentTheme));
      this.renderSelectedTrack();
    } catch (error) {
      if (this.destroyed) return;
      this.initializationFailed.set(true);
      this.logger.error('[HomeMyTracksPreviewComponent] Failed to initialize sample MyTracks map.', error);
    }
  }

  selectPreview(index: number): void {
    if (!HOME_MY_TRACKS_PREVIEW_TRACKS[index] || index === this.selectedPreviewIndex()) return;

    this.selectedPreviewIndex.set(index);
    this.hapticsService.selection();
    if (this.mapViewHandle) {
      this.renderSelectedTrack();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.mapViewHandle?.destroy();
    this.mapViewHandle = null;
    this.styleSynchronizer = null;
  }

  private renderSelectedTrack(): void {
    const track = HOME_MY_TRACKS_PREVIEW_TRACKS[this.selectedPreviewIndex()];
    if (!track) return;

    this.manager.setTracksFromPrepared([track]);
    this.manager.fitBoundsToCoordinates(track.coordinates, {
      padding: 42,
      animate: false,
    });
  }
}
