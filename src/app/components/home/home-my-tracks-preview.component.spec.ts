import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PLATFORM_ID, signal } from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AppThemeService } from '../../services/app.theme.service';
import { LoggerService } from '../../services/logger.service';
import { MapStyleService } from '../../services/map-style.service';
import { MyTracksMapViewFactory } from '../shared/my-tracks-map-view/my-tracks-map-view.factory';
import { HOME_MY_TRACKS_PREVIEW_TRACKS } from './home-my-tracks-preview.data';
import { HomeMyTracksPreviewComponent } from './home-my-tracks-preview.component';

describe('HomeMyTracksPreviewComponent', () => {
  let fixture: ComponentFixture<HomeMyTracksPreviewComponent>;
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
    factory.initialize.mockResolvedValue(handle);

    await TestBed.configureTestingModule({
      imports: [HomeMyTracksPreviewComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
        { provide: MapStyleService, useValue: mapStyle },
        { provide: MyTracksMapViewFactory, useValue: factory },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeMyTracksPreviewComponent);
  });

  it('renders deterministic sample activities through the shared MyTracks map view', async () => {
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
    expect(manager.setTracksFromPrepared).toHaveBeenCalledWith(HOME_MY_TRACKS_PREVIEW_TRACKS);
    expect(manager.fitBoundsToCoordinates).toHaveBeenCalledWith(
      expect.any(Array),
      { padding: 36, animate: false },
    );
    expect(fixture.nativeElement.querySelector('[aria-label*="sample running"]')).toBeTruthy();
  });

  it('disposes the same shared map handle on destroy', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.destroy();

    expect(handle.destroy).toHaveBeenCalledTimes(1);
  });
});
