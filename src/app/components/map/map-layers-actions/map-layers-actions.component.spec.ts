import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MapLayersActionsComponent } from './map-layers-actions.component';
import { MapStyleService } from '../../../services/map-style.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';

describe('MapLayersActionsComponent', () => {
  let component: MapLayersActionsComponent;
  let fixture: ComponentFixture<MapLayersActionsComponent>;
  let mapStyleServiceMock: any;
  let analyticsServiceMock: any;

  beforeEach(async () => {
    mapStyleServiceMock = {
      getSupportedStyleOptions: vi.fn().mockReturnValue([
        { value: 'default', label: 'Default' },
        { value: 'satellite', label: 'Satellite' },
      ]),
      normalizeStyle: vi.fn().mockImplementation((value: string) => value || 'default'),
    };

    analyticsServiceMock = {
      logEvent: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [
        MatMenuModule,
        MatIconModule,
        MatSlideToggleModule,
        MatTooltipModule,
        MatDividerModule,
        BrowserAnimationsModule,
      ],
      declarations: [MapLayersActionsComponent],
      providers: [
        { provide: MapStyleService, useValue: mapStyleServiceMock },
        { provide: AppAnalyticsService, useValue: analyticsServiceMock },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(MapLayersActionsComponent);
    component = fixture.componentInstance;
    component.user = { uid: 'user-1', settings: signal({}) } as any;
    fixture.detectChanges();
  });

  it('renders style options from style service', () => {
    expect(component.mapStyleOptions).toEqual([
      { value: 'default', label: 'Default' },
      { value: 'satellite', label: 'Satellite' },
    ]);
    expect(mapStyleServiceMock.getSupportedStyleOptions).toHaveBeenCalled();
  });

  it('emits map style and logs analytics on style change', () => {
    const mapStyleEmitSpy = vi.spyOn(component.mapStyleChange, 'emit');

    component.onMapStyleSelect('satellite');

    expect(mapStyleEmitSpy).toHaveBeenCalledWith('satellite');
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_map_settings_change');
  });

  it('emits 3d and jump heat toggles', () => {
    const is3DEmitSpy = vi.spyOn(component.is3DChange, 'emit');
    const jumpHeatEmitSpy = vi.spyOn(component.showJumpHeatmapChange, 'emit');

    component.onShow3DToggle(true);
    component.onShowJumpHeatmapToggle(true);

    expect(is3DEmitSpy).toHaveBeenCalledWith(true);
    expect(jumpHeatEmitSpy).toHaveBeenCalledWith(true);
  });

  it('respects analytics event name override', () => {
    component.analyticsEventName = 'my_tracks_map_settings_change';
    component.onShow3DToggle(true);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('my_tracks_map_settings_change');
  });
});
