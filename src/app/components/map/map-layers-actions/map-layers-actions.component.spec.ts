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
import { MapLayersMenuPanelComponent } from '../shared/map-layers-menu-panel.component';
import { MenuRadioListComponent } from '../../shared/menu-radio-list/menu-radio-list.component';
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
      declarations: [MapLayersActionsComponent, MapLayersMenuPanelComponent, MenuRadioListComponent],
      providers: [
        { provide: MapStyleService, useValue: mapStyleServiceMock },
        { provide: AppAnalyticsService, useValue: analyticsServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MapLayersActionsComponent);
    component = fixture.componentInstance;
    component.user = { uid: 'user-1', settings: signal({}) } as any;
    fixture.detectChanges();
  });

  it('renders the header map layers button', () => {
    const button = fixture.nativeElement.querySelector('button[aria-label="Map layers"]');
    expect(button).not.toBeNull();
  });
});
