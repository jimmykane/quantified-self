import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AppThemes } from '@sports-alliance/sports-lib';
import type { Map as MapboxMap, MapOptions } from 'mapbox-gl';
import type {
  AssistantMapMarker,
  AssistantMapVisual,
} from '@shared/assistant.types';
import { AppAuthService } from '../../authentication/app.auth.service';
import type { AppMapStyleName } from '../../models/app-user.interface';
import { MaterialModule } from '../../modules/material.module';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { LoggerService } from '../../services/logger.service';
import { MapStyleService } from '../../services/map-style.service';
import { MapboxLoaderService } from '../../services/mapbox-loader.service';
import { MapboxAutoResizeService } from '../../services/map/mapbox-auto-resize.service';
import {
  MapboxLayersControlService,
  type MapboxLayersControlHandle,
} from '../../services/map/mapbox-layers-control.service';
import type { MapboxStyleSynchronizer } from '../../services/map/mapbox-style-synchronizer';
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
const ASSISTANT_MAP_MAX_FIT_ZOOM = 16;

@Component({
  selector: 'app-assistant-visual-map',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  templateUrl: './assistant-visual-map.component.html',
  styleUrls: ['./assistant-visual-map.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantVisualMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) visual!: AssistantMapVisual;
  @ViewChild('mapDiv', { static: true }) mapDiv!: ElementRef<HTMLDivElement>;

  private readonly mapboxLoader = inject(MapboxLoaderService);
  private readonly mapboxAutoResize = inject(MapboxAutoResizeService);
  private readonly mapboxLayersControl = inject(MapboxLayersControlService);
  private readonly mapStyleService = inject(MapStyleService);
  private readonly userSettingsQuery = inject(AppUserSettingsQueryService);
  private readonly authService = inject(AppAuthService);
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
  private map: MapboxMap | null = null;
  private viewInitialized = false;
  private lifecycleVersion = 0;
  private fitHandler: (() => void) | null = null;
  private mapStyleSynchronizer: MapboxStyleSynchronizer | null = null;
  private mapLayersControlHandle: MapboxLayersControlHandle | null = null;
  private readonly currentUser = toSignal(this.authService.user$, { initialValue: null });

  constructor() {
    effect(() => {
      const mapStyle = this.getAssistantMapStyle();
      const theme = this.themeService.appTheme() || AppThemes.Normal;
      this.mapStyleSynchronizer?.update(this.mapStyleService.resolve(mapStyle, theme));
      this.mapLayersControlHandle?.updateInputs({
        user: this.currentUser() ?? undefined,
        mapStyle,
      });
    });
  }

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
    let pendingMap: MapboxMap | null = null;
    const lifecycleVersion = ++this.lifecycleVersion;
    this.loading.set(true);
    this.loadFailed.set(false);
    try {
      const firstPosition = this.visual.path[0] ?? this.visual.markers[0];
      const mapStyle = this.getAssistantMapStyle();
      const resolvedStyle = this.mapStyleService.resolve(
        mapStyle,
        this.themeService.appTheme() || AppThemes.Normal,
      );
      const options: Omit<MapOptions, 'container'> = {
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
      this.mapStyleSynchronizer = this.mapStyleService.createSynchronizer(map, resolvedStyle);
      this.mapLayersControlHandle = this.mapboxLayersControl.create({
        inputs: {
          user: this.currentUser() ?? undefined,
          mapStyle,
          enableJumpHeatmapToggle: false,
          enableLapsToggle: false,
          enableArrowsToggle: false,
          enable3DToggle: false,
          analyticsEventName: 'assistant_map_style_change',
        },
        outputs: {
          mapStyleChange: style => this.updateAssistantMapStyle(style),
        },
      });
      map.addControl(this.mapLayersControlHandle.control, 'top-left');
      this.mapManager.setMap(map, mapboxgl);
      this.mapboxAutoResize.bind(map, {
        container,
        throttleMs: 150,
        onResize: () => this.mapManager.fitBoundsToTracks(
          false,
          ASSISTANT_MAP_MAX_FIT_ZOOM,
        ),
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
        fitted = this.mapManager.fitBoundsToTracks(
          false,
          ASSISTANT_MAP_MAX_FIT_ZOOM,
        );
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

  private getAssistantMapStyle(): AppMapStyleName {
    return this.mapStyleService.normalizeStyle(
      this.userSettingsQuery.mapSettings()?.assistantMapStyle,
    );
  }

  private updateAssistantMapStyle(style: AppMapStyleName): void {
    const mapStyle = this.mapStyleService.normalizeStyle(style);
    const resolvedStyle = this.mapStyleService.resolve(
      mapStyle,
      this.themeService.appTheme() || AppThemes.Normal,
    );
    this.mapStyleSynchronizer?.update(resolvedStyle);
    this.mapLayersControlHandle?.updateInputs({ mapStyle });
    void this.userSettingsQuery.updateMapSettings({ assistantMapStyle: mapStyle });
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
    this.mapLayersControlHandle?.destroy();
    this.mapLayersControlHandle = null;
    this.mapStyleSynchronizer = null;
    try {
      this.mapManager.clearAll({ mapWillBeRemoved: true });
      this.mapboxAutoResize.unbind(map);
    } finally {
      map?.remove?.();
      this.map = null;
    }
  }
}
