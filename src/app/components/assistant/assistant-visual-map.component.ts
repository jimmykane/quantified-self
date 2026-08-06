import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import type {
  AssistantMapMarker,
  AssistantMapVisual,
} from '@shared/assistant.types';
import { MaterialModule } from '../../modules/material.module';
import { AppThemeService } from '../../services/app.theme.service';
import { LoggerService } from '../../services/logger.service';
import { MapStyleService } from '../../services/map-style.service';
import { MapboxLoaderService } from '../../services/mapbox-loader.service';
import { MapboxAutoResizeService } from '../../services/map/mapbox-auto-resize.service';
import { MarkerFactoryService } from '../../services/map/marker-factory.service';
import {
  TrackMapManager,
  type TrackMapExtraMarkerRenderData,
} from '../../services/map/track-map.manager';

const MARKER_PRESENTATION: Record<AssistantMapMarker['kind'], {
  color: string;
  icon: string;
}> = {
  start: { color: '#10b981', icon: 'play_arrow' },
  end: { color: '#ef4444', icon: 'stop' },
  jump: { color: '#f59e0b', icon: 'air' },
  nearby: { color: '#8b5cf6', icon: 'near_me' },
  search: { color: '#2196f3', icon: 'search' },
};

@Component({
  selector: 'app-assistant-visual-map',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  template: `
    <div class="assistant-map-shell">
      <div #mapDiv class="assistant-visual-map" role="img" [attr.aria-label]="visual.title"></div>
      @if (loading()) {
        <div class="assistant-map-state" aria-live="polite">
          <mat-spinner diameter="24"></mat-spinner>
          <span>Loading satellite map…</span>
        </div>
      } @else if (loadFailed()) {
        <div class="assistant-map-state assistant-map-error" role="status">
          <mat-icon>map</mat-icon>
          <span>The map could not be loaded. The answer remains available.</span>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .assistant-map-shell {
      position: relative;
      min-height: 220px;
      overflow: hidden;
      border-radius: 14px;
      background: var(--mat-sys-surface-container);
    }
    .assistant-visual-map { width: 100%; height: 220px; }
    .assistant-map-state {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      justify-items: center;
      gap: 9px;
      padding: 20px;
      color: var(--mat-sys-on-surface-variant);
      background: var(--mat-sys-surface-container);
      text-align: center;
      font-size: 0.84rem;
    }
    .assistant-map-error mat-icon { color: var(--mat-sys-error); }
    :host-context(.assistant-visual-detail) .assistant-map-shell,
    :host-context(.assistant-visual-detail) .assistant-visual-map {
      min-height: min(66vh, 580px);
      height: min(66vh, 580px);
    }
    @media (max-width: 720px) {
      .assistant-map-shell,
      .assistant-visual-map { min-height: 210px; height: 210px; }
      :host-context(.assistant-visual-detail) .assistant-map-shell,
      :host-context(.assistant-visual-detail) .assistant-visual-map {
        min-height: min(62vh, 500px);
        height: min(62vh, 500px);
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantVisualMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) visual!: AssistantMapVisual;
  @ViewChild('mapDiv', { static: true }) mapDiv!: ElementRef<HTMLDivElement>;

  private readonly zone = inject(NgZone);
  private readonly mapboxLoader = inject(MapboxLoaderService);
  private readonly mapboxAutoResize = inject(MapboxAutoResizeService);
  private readonly mapStyleService = inject(MapStyleService);
  private readonly themeService = inject(AppThemeService);
  private readonly markerFactory = inject(MarkerFactoryService);
  private readonly logger = inject(LoggerService);
  private readonly mapManager = new TrackMapManager(
    this.markerFactory,
    this.logger,
    {
      layerPrefix: 'assistant-visual',
      logPrefix: 'AssistantVisualMapManager',
      combineTrackLayers: true,
    },
  );
  private map: any | null = null;
  private viewInitialized = false;
  private lifecycleVersion = 0;
  private fitHandler: (() => void) | null = null;

  readonly loading = signal(true);
  readonly loadFailed = signal(false);

  async ngAfterViewInit(): Promise<void> {
    this.viewInitialized = true;
    await this.initializeMap();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.viewInitialized && changes.visual) {
      this.destroyMap();
      void this.initializeMap();
    }
  }

  ngOnDestroy(): void {
    this.viewInitialized = false;
    this.destroyMap();
  }

  private async initializeMap(): Promise<void> {
    const container = this.mapDiv?.nativeElement;
    if (!container || !this.visual || this.map) {
      return;
    }
    let pendingMap: any | null = null;
    const lifecycleVersion = ++this.lifecycleVersion;
    this.loading.set(true);
    this.loadFailed.set(false);
    try {
      const firstPosition = this.visual.path[0] ?? this.visual.markers[0];
      const resolvedStyle = this.mapStyleService.resolve(
        'satellite',
        this.themeService.appTheme() || AppThemes.Normal,
      );
      const options: Record<string, unknown> = {
        style: resolvedStyle.styleUrl,
        center: firstPosition
          ? [firstPosition.longitudeDegrees, firstPosition.latitudeDegrees]
          : [0, 0],
        zoom: firstPosition ? 11 : 2,
        attributionControl: true,
      };
      if (resolvedStyle.preset) {
        options.config = { basemap: { lightPreset: resolvedStyle.preset } };
      }
      pendingMap = await this.mapboxLoader.createMap(container, options);
      if (!this.viewInitialized || lifecycleVersion !== this.lifecycleVersion) {
        pendingMap.remove?.();
        pendingMap = null;
        return;
      }
      const mapboxgl = await this.mapboxLoader.loadMapbox();
      if (!this.viewInitialized || lifecycleVersion !== this.lifecycleVersion) {
        pendingMap.remove?.();
        pendingMap = null;
        return;
      }
      const map = pendingMap;
      this.map = map;
      pendingMap = null;
      this.mapManager.setMap(map, mapboxgl);
      this.mapboxAutoResize.bind(map, {
        container,
        throttleMs: 150,
        onResize: () => this.zone.run(() => this.mapManager.fitBoundsToTracks(false)),
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new mapboxgl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
      this.mapManager.renderTrackData([{
        id: 'assistant-visual-track',
        label: this.visual.title,
        strokeColor: '#38bdf8',
        positions: this.visual.path,
        markers: this.buildMarkers(this.visual.markers),
      }], {
        showArrows: false,
        showEndpointMarkers: false,
        strokeWidth: 4,
      });
      let fitted = false;
      this.fitHandler = () => {
        if (fitted || !this.map) {
          return;
        }
        fitted = this.mapManager.fitBoundsToTracks(false);
        if (fitted) {
          this.loading.set(false);
        }
      };
      map.on('load', this.fitHandler);
      map.on('idle', this.fitHandler);
      this.fitHandler();
    } catch (error) {
      pendingMap?.remove?.();
      if (lifecycleVersion !== this.lifecycleVersion) {
        return;
      }
      this.logger.warn('[AssistantVisualMapComponent] Failed to initialize map.', { error });
      this.loading.set(false);
      this.loadFailed.set(true);
      this.destroyMap(false);
    }
  }

  private buildMarkers(markers: AssistantMapMarker[]): TrackMapExtraMarkerRenderData[] {
    return markers.map((mapMarker, index) => {
      const presentation = MARKER_PRESENTATION[mapMarker.kind];
      return {
        id: `${mapMarker.kind}-${index}`,
        latitudeDegrees: mapMarker.latitudeDegrees,
        longitudeDegrees: mapMarker.longitudeDegrees,
        anchor: 'center',
        element: this.markerFactory.createCompactIconMarker({
          color: presentation.color,
          icon: presentation.icon,
          title: mapMarker.label,
          ariaLabel: mapMarker.label,
        }),
      };
    });
  }

  private destroyMap(incrementLifecycle = true): void {
    if (incrementLifecycle) {
      this.lifecycleVersion += 1;
    }
    const map = this.map;
    if (map && this.fitHandler) {
      map.off?.('load', this.fitHandler);
      map.off?.('idle', this.fitHandler);
    }
    this.fitHandler = null;
    try {
      this.mapManager.clearAll({ mapWillBeRemoved: true });
      this.mapboxAutoResize.unbind(map);
    } finally {
      map?.remove?.();
      this.map = null;
    }
  }
}
