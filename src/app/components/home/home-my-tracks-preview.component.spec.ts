import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PLATFORM_ID, signal } from '@angular/core';
import { ActivityTypes, AppThemes } from '@sports-alliance/sports-lib';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AppThemeService } from '../../services/app.theme.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { LoggerService } from '../../services/logger.service';
import { MapStyleService } from '../../services/map-style.service';
import { MyTracksMapViewFactory } from '../shared/my-tracks-map-view/my-tracks-map-view.factory';
import { HOME_MY_TRACKS_PREVIEW_TRACKS } from './home-my-tracks-preview.data';
import { HomeMyTracksPreviewComponent } from './home-my-tracks-preview.component';

describe('HomeMyTracksPreviewComponent', () => {
  let fixture: ComponentFixture<HomeMyTracksPreviewComponent>;
  const appTheme = signal(AppThemes.Normal);
  const map = {};
  const handle = { map, mapboxgl: {}, manager: {}, destroy: vi.fn() };
  const manager = {
    setIsDarkTheme: vi.fn(),
    refreshTrackColors: vi.fn(),
    setMapStyle: vi.fn(),
    setTracksFromPrepared: vi.fn(),
    fitBoundsToCoordinates: vi.fn(),
  };
  const factory = {
    createManager: vi.fn(() => manager),
    initialize: vi.fn().mockResolvedValue(handle),
  };
  const synchronizer = { update: vi.fn() };
  const haptics = { selection: vi.fn() };
  const mapStyle = {
    resolve: vi.fn(() => ({
      styleUrl: 'mapbox://styles/mapbox/standard',
      preset: 'day',
    })),
    isStandard: vi.fn(() => true),
    createSynchronizer: vi.fn(() => synchronizer),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    appTheme.set(AppThemes.Normal);
    factory.initialize.mockResolvedValue(handle);

    await TestBed.configureTestingModule({
      imports: [HomeMyTracksPreviewComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AppHapticsService, useValue: haptics },
        { provide: AppThemeService, useValue: { appTheme } },
        { provide: MapStyleService, useValue: mapStyle },
        { provide: MyTracksMapViewFactory, useValue: factory },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeMyTracksPreviewComponent);
  });

  it('renders the real MTB preview through the shared MyTracks map view', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(factory.initialize).toHaveBeenCalledWith(
      manager,
      expect.any(HTMLDivElement),
      expect.objectContaining({
        style: 'mapbox://styles/mapbox/standard',
        cooperativeGestures: true,
      }),
      { controlMode: 'preview' },
    );
    expect(manager.setTracksFromPrepared).toHaveBeenCalledWith([HOME_MY_TRACKS_PREVIEW_TRACKS[2]]);
    expect(manager.fitBoundsToCoordinates).toHaveBeenCalledWith(
      HOME_MY_TRACKS_PREVIEW_TRACKS[2].coordinates,
      { padding: 42, animate: false },
    );
    expect(fixture.nativeElement.querySelector('[aria-label="Interactive MyTracks preview showing a real activity trace"]')).toBeTruthy();
    expect(HOME_MY_TRACKS_PREVIEW_TRACKS.map((track) => track.activity.type)).toEqual([
      ActivityTypes.OpenWaterSwimming,
      ActivityTypes.TrailRunning,
      ActivityTypes.MountainBiking,
    ]);
    expect(HOME_MY_TRACKS_PREVIEW_TRACKS.every((track) => track.coordinates.length > 60)).toBe(true);
    expect(HOME_MY_TRACKS_PREVIEW_TRACKS.map((track) => track.activity.getID())).toEqual([
      'preview-open-water',
      'preview-trail-run',
      'preview-mountain-bike',
    ]);
  });

  it('switches to a readable real trace with haptic feedback', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const openWaterButton = fixture.nativeElement.querySelector(
      '[aria-label="Show open-water swimming activity"]',
    ) as HTMLButtonElement;
    openWaterButton.click();
    fixture.detectChanges();

    expect(haptics.selection).toHaveBeenCalledTimes(1);
    expect(manager.setTracksFromPrepared).toHaveBeenLastCalledWith([HOME_MY_TRACKS_PREVIEW_TRACKS[0]]);
    expect(manager.fitBoundsToCoordinates).toHaveBeenLastCalledWith(
      HOME_MY_TRACKS_PREVIEW_TRACKS[0].coordinates,
      { padding: 42, animate: false },
    );
    expect(openWaterButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('disposes the same shared map handle on destroy', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.destroy();

    expect(handle.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys a map handle that resolves after the deferred preview is gone', async () => {
    let resolveHandle!: (value: typeof handle) => void;
    factory.initialize.mockReturnValueOnce(new Promise((resolve) => {
      resolveHandle = resolve;
    }));
    fixture.detectChanges();
    await Promise.resolve();

    fixture.destroy();
    resolveHandle(handle);
    await Promise.resolve();
    await Promise.resolve();

    expect(handle.destroy).toHaveBeenCalledTimes(1);
    expect(manager.setTracksFromPrepared).not.toHaveBeenCalled();
  });

  it('applies the latest theme when it changes during map initialization', async () => {
    let resolveHandle!: (value: typeof handle) => void;
    factory.initialize.mockReturnValueOnce(new Promise((resolve) => {
      resolveHandle = resolve;
    }));
    fixture.detectChanges();
    await Promise.resolve();

    appTheme.set(AppThemes.Dark);
    fixture.detectChanges();
    resolveHandle(handle);
    await fixture.whenStable();

    expect(manager.setIsDarkTheme).toHaveBeenLastCalledWith(true);
    expect(mapStyle.resolve).toHaveBeenCalledWith('default', AppThemes.Dark);
    expect(synchronizer.update).toHaveBeenCalled();
  });
});
