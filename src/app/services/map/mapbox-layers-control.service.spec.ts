import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppAnalyticsService } from '../app.analytics.service';
import { MapStyleService } from '../map-style.service';
import { MyTracksMapLayersControlComponent } from '../../components/map/my-tracks-map-layers-control/my-tracks-map-layers-control.component';
import { MapLayersMenuPanelComponent } from '../../components/map/shared/map-layers-menu-panel.component';
import { MenuRadioListComponent } from '../../components/shared/menu-radio-list/menu-radio-list.component';
import { MapboxLayersControlService } from './mapbox-layers-control.service';

describe('MapboxLayersControlService', () => {
  let service: MapboxLayersControlService;
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
        BrowserAnimationsModule,
        MatMenuModule,
        MatIconModule,
        MatSlideToggleModule,
        MatTooltipModule,
        MatDividerModule,
      ],
      declarations: [MyTracksMapLayersControlComponent, MapLayersMenuPanelComponent, MenuRadioListComponent],
      providers: [
        MapboxLayersControlService,
        { provide: MapStyleService, useValue: mapStyleServiceMock },
        { provide: AppAnalyticsService, useValue: analyticsServiceMock },
      ],
    }).compileComponents();

    service = TestBed.inject(MapboxLayersControlService);
  });

  it('creates a mapbox control container hosting the layers button', () => {
    const handle = service.create({
      inputs: {
        user: { uid: 'user-1', settings: signal({}) } as any,
      },
    });

    const container = handle.control.onAdd({});
    const button = container.querySelector('button[aria-label="Map layers"]');

    expect(container.className).toContain('mapboxgl-ctrl');
    expect(button).not.toBeNull();
  });

  it('updates component inputs after control creation', () => {
    const handle = service.create({
      inputs: {
        user: { uid: 'user-1', settings: signal({}) } as any,
        disabled: false,
      },
    });

    const container = handle.control.onAdd({});
    const button = container.querySelector('button[aria-label="Map layers"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    handle.updateInputs({ disabled: true });

    expect(button.disabled).toBe(true);
  });

  it('bridges component outputs to host callbacks', () => {
    const mapStyleChange = vi.fn();
    const is3DChange = vi.fn();
    const showJumpHeatmapChange = vi.fn();
    const handle = service.create({
      outputs: {
        mapStyleChange,
        is3DChange,
        showJumpHeatmapChange,
      },
    });

    handle.instance.mapStyleChange.emit('satellite');
    handle.instance.is3DChange.emit(true);
    handle.instance.showJumpHeatmapChange.emit(true);

    expect(mapStyleChange).toHaveBeenCalledWith('satellite');
    expect(is3DChange).toHaveBeenCalledWith(true);
    expect(showJumpHeatmapChange).toHaveBeenCalledWith(true);
  });

  it('destroys the hosted component when removed', () => {
    const handle = service.create({
      inputs: {
        user: { uid: 'user-1', settings: signal({}) } as any,
      },
    });

    const parent = document.createElement('div');
    const container = handle.control.onAdd({});
    parent.appendChild(container);

    handle.control.onRemove();

    expect(parent.contains(container)).toBe(false);
  });
});
