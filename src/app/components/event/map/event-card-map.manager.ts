import { DataJumpEvent } from '@sports-alliance/sports-lib';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';
import { LoggerService } from '../../../services/logger.service';
import {
  TrackMapCursorRenderData,
  TrackMapClearOptions,
  TrackMapExtraMarkerRenderData,
  TrackMapManager,
  TrackMapRenderData,
} from '../../../services/map/track-map.manager';

export interface EventTrackLapRenderData {
  lapIndex: number;
  latitudeDegrees: number;
  longitudeDegrees: number;
}

export interface EventTrackJumpRenderData {
  event: DataJumpEvent;
  latitudeDegrees: number;
  longitudeDegrees: number;
  markerSize: number;
}

export interface EventTrackRenderData {
  activityId: string;
  strokeColor: string;
  positions: Array<{ latitudeDegrees: number; longitudeDegrees: number }>;
  laps: EventTrackLapRenderData[];
  jumps: EventTrackJumpRenderData[];
}

export interface EventCursorRenderData {
  activityId: string;
  latitudeDegrees: number;
  longitudeDegrees: number;
  color: string;
}

export interface EventMapRenderOptions {
  showArrows: boolean;
  strokeWidth: number;
}

type JumpClickHandler = (jump: DataJumpEvent, latitudeDegrees: number, longitudeDegrees: number) => void;

export class EventCardMapManager {
  private readonly trackManager: TrackMapManager;
  private jumpClickHandler: JumpClickHandler | null = null;

  constructor(
    private markerFactory: MarkerFactoryService,
    logger: LoggerService,
  ) {
    this.trackManager = new TrackMapManager(this.markerFactory, logger, {
      layerPrefix: 'event-track',
      logPrefix: 'EventCardMapManager',
    });
  }

  public setMap(map: any, mapboxgl: any): void {
    this.trackManager.setMap(map, mapboxgl);
  }

  public setJumpClickHandler(handler: JumpClickHandler | null): void {
    this.jumpClickHandler = handler;
  }

  public renderActivities(tracks: EventTrackRenderData[], options: EventMapRenderOptions): void {
    this.trackManager.renderTrackData((tracks || []).map((track) => this.toTrackRenderData(track)), options);
  }

  public setCursorMarkers(cursors: EventCursorRenderData[]): void {
    const trackCursors: TrackMapCursorRenderData[] = (cursors || []).map((cursor) => ({
      trackId: cursor.activityId,
      latitudeDegrees: cursor.latitudeDegrees,
      longitudeDegrees: cursor.longitudeDegrees,
      color: cursor.color,
    }));
    this.trackManager.setCursorMarkers(trackCursors);
  }

  public clearCursorMarkers(): void {
    this.trackManager.clearCursorMarkers();
  }

  public clearAll(options?: TrackMapClearOptions): void {
    this.trackManager.clearAll(options);
  }

  public toggleTerrain(enable: boolean, animate: boolean = true): void {
    this.trackManager.toggleTerrain(enable, animate);
  }

  public fitBoundsToTracks(animate: boolean = true): boolean {
    return this.trackManager.fitBoundsToTracks(animate);
  }

  public project(latitudeDegrees: number, longitudeDegrees: number): { x: number; y: number } | null {
    return this.trackManager.project(latitudeDegrees, longitudeDegrees);
  }

  private toTrackRenderData(track: EventTrackRenderData): TrackMapRenderData {
    return {
      id: track.activityId,
      strokeColor: track.strokeColor,
      positions: track.positions,
      markers: [
        ...this.toLapMarkers(track),
        ...this.toJumpMarkers(track),
      ],
    };
  }

  private toLapMarkers(track: EventTrackRenderData): TrackMapExtraMarkerRenderData[] {
    return (track.laps || []).map((lap) => ({
      id: `${track.activityId}-lap-${lap.lapIndex}`,
      latitudeDegrees: lap.latitudeDegrees,
      longitudeDegrees: lap.longitudeDegrees,
      element: this.markerFactory.createLapMarker(track.strokeColor, lap.lapIndex),
    }));
  }

  private toJumpMarkers(track: EventTrackRenderData): TrackMapExtraMarkerRenderData[] {
    return (track.jumps || []).map((jump, index) => {
      const element = this.markerFactory.createJumpMarker(track.strokeColor, jump.markerSize);
      element.addEventListener('click', (event: Event) => {
        event.stopPropagation();
        this.jumpClickHandler?.(jump.event, jump.latitudeDegrees, jump.longitudeDegrees);
      });
      return {
        id: `${track.activityId}-jump-${index}`,
        latitudeDegrees: jump.latitudeDegrees,
        longitudeDegrees: jump.longitudeDegrees,
        element,
      };
    });
  }
}
