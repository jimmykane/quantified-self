import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
  computed,
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
import type { AppMyTracksTripSortDirection } from '../../models/app-user.interface';
import {
  MyTracksMapViewFactory,
  type MyTracksMapViewHandle,
} from '../shared/my-tracks-map-view/my-tracks-map-view.factory';
import type { MyTracksTripPanelItem } from '../shared/my-tracks-trips-panel/my-tracks-trips-panel.component';
import { SharedModule } from '../../modules/shared.module';
import {
  HOME_MY_TRACKS_PREVIEW_HOME_AREA,
  HOME_MY_TRACKS_PREVIEW_TRACKS,
  HOME_MY_TRACKS_PREVIEW_TRIPS,
} from './home-my-tracks-preview.data';

@Component({
  selector: 'app-home-my-tracks-preview',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './home-my-tracks-preview.component.html',
  styleUrls: ['./home-my-tracks-preview.component.scss'],
})
export class HomeMyTracksPreviewComponent implements AfterViewInit, OnDestroy {
  private static readonly HOME_PANEL_ENTRY_ID = '__preview_home_panel_entry__';

  @ViewChild('mapContainer', { static: true }) private mapContainer!: ElementRef<HTMLDivElement>;

  readonly initializationFailed = signal(false);
  readonly previewHomeArea = HOME_MY_TRACKS_PREVIEW_HOME_AREA;
  readonly tripsPanelExpanded = signal(true);
  readonly tripSortDirection = signal<AppMyTracksTripSortDirection>('desc');
  readonly selectedPreviewTripId = signal(HOME_MY_TRACKS_PREVIEW_TRIPS[0].tripId);
  readonly hoveredPreviewTripId = signal<string | null>(null);
  readonly displayedPreviewTrips = computed(() => {
    const multiplier = this.tripSortDirection() === 'desc' ? -1 : 1;
    return [...HOME_MY_TRACKS_PREVIEW_TRIPS].sort((left, right) => (
      (left.startDate.getTime() - right.startDate.getTime()) * multiplier
      || (left.endDate.getTime() - right.endDate.getTime()) * multiplier
      || left.tripId.localeCompare(right.tripId)
    ));
  });
  readonly homeSelected = computed(() => (
    this.selectedPreviewTripId() === HomeMyTracksPreviewComponent.HOME_PANEL_ENTRY_ID
  ));

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
      this.manager.setTracksFromPrepared([...HOME_MY_TRACKS_PREVIEW_TRACKS]);
      this.manager.setHomeArea(HOME_MY_TRACKS_PREVIEW_HOME_AREA);
      this.applyActiveTripArea();
      this.fitSelectedPreview();
    } catch (error) {
      if (this.destroyed) return;
      this.mapViewHandle?.destroy();
      this.mapViewHandle = null;
      this.styleSynchronizer = null;
      this.initializationFailed.set(true);
      this.logger.error('[HomeMyTracksPreviewComponent] Failed to initialize sample MyTracks map.', error);
    }
  }

  selectPreviewTrip(trip: MyTracksTripPanelItem): void {
    this.selectedPreviewTripId.set(trip.tripId);
    this.hapticsService.selection();
    if (this.mapViewHandle) {
      this.applyActiveTripArea();
      this.fitTrip(trip);
    }
  }

  selectPreviewHome(): void {
    this.selectedPreviewTripId.set(HomeMyTracksPreviewComponent.HOME_PANEL_ENTRY_ID);
    this.hapticsService.selection();
    if (!this.mapViewHandle) return;

    this.applyActiveTripArea();
    this.fitPreviewHome(true);
  }

  hoverPreviewTrip(trip: MyTracksTripPanelItem): void {
    this.hoveredPreviewTripId.set(trip.tripId);
    if (this.mapViewHandle) this.applyActiveTripArea();
  }

  endPreviewTripHover(trip: MyTracksTripPanelItem): void {
    if (this.hoveredPreviewTripId() !== trip.tripId) return;

    this.hoveredPreviewTripId.set(null);
    if (this.mapViewHandle) this.applyActiveTripArea();
  }

  hoverPreviewHome(): void {
    this.hoveredPreviewTripId.set(HomeMyTracksPreviewComponent.HOME_PANEL_ENTRY_ID);
    if (this.mapViewHandle) this.applyActiveTripArea();
  }

  endPreviewHomeHover(): void {
    if (this.hoveredPreviewTripId() !== HomeMyTracksPreviewComponent.HOME_PANEL_ENTRY_ID) return;

    this.hoveredPreviewTripId.set(null);
    if (this.mapViewHandle) this.applyActiveTripArea();
  }

  toggleTripSortDirection(): void {
    this.tripSortDirection.update((direction) => direction === 'desc' ? 'asc' : 'desc');
    this.hapticsService.selection();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.mapViewHandle?.destroy();
    this.mapViewHandle = null;
    this.styleSynchronizer = null;
  }

  private fitSelectedPreview(): void {
    if (this.homeSelected()) {
      this.fitPreviewHome(false);
      return;
    }

    const selectedTrip = HOME_MY_TRACKS_PREVIEW_TRIPS.find(
      (trip) => trip.tripId === this.selectedPreviewTripId(),
    );
    if (selectedTrip) this.fitTrip(selectedTrip, false);
  }

  private fitTrip(trip: MyTracksTripPanelItem, animate = true): void {
    const eventIds = new Set(trip.eventIds);
    const coordinates = HOME_MY_TRACKS_PREVIEW_TRACKS
      .filter((track) => eventIds.has(String(track.activity.getID?.())))
      .flatMap((track) => track.coordinates);

    this.manager.fitBoundsToCoordinates(coordinates.length > 0 ? coordinates : [
      [trip.bounds.west, trip.bounds.south],
      [trip.bounds.east, trip.bounds.north],
    ], {
      padding: 42,
      animate,
    });
  }

  private fitPreviewHome(animate: boolean): void {
    this.manager.fitBoundsToCoordinates([
      [HOME_MY_TRACKS_PREVIEW_HOME_AREA.bounds.west, HOME_MY_TRACKS_PREVIEW_HOME_AREA.bounds.south],
      [HOME_MY_TRACKS_PREVIEW_HOME_AREA.bounds.east, HOME_MY_TRACKS_PREVIEW_HOME_AREA.bounds.north],
    ], { padding: 42, animate });
  }

  private applyActiveTripArea(): void {
    const activeId = this.hoveredPreviewTripId() || this.selectedPreviewTripId();
    const activeTrip = HOME_MY_TRACKS_PREVIEW_TRIPS.find((trip) => trip.tripId === activeId);
    this.manager.setTripArea(activeTrip ? {
      tripId: activeTrip.tripId,
      centroidLat: activeTrip.centroidLat,
      centroidLng: activeTrip.centroidLng,
      bounds: { ...activeTrip.bounds },
    } : null);
  }
}
