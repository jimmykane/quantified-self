import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { User } from '@sports-alliance/sports-lib';
import { vi } from 'vitest';
import { MapActionsComponent } from './map.actions.component';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';

describe('MapActionsComponent', () => {
    let component: MapActionsComponent;
    let fixture: ComponentFixture<MapActionsComponent>;

    const analyticsServiceMock = {
        logEvent: vi.fn(),
    };

    const userMock = {
        settings: {
            mapSettings: {
                showLaps: false,
                showArrows: false,
            },
        },
    } as unknown as User;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [MapActionsComponent],
            imports: [
                BrowserAnimationsModule,
                MatButtonModule,
                MatDividerModule,
                MatIconModule,
                MatMenuModule,
                MatSlideToggleModule,
                MatTooltipModule,
            ],
            providers: [
                { provide: AppAnalyticsService, useValue: analyticsServiceMock },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(MapActionsComponent);
        component = fixture.componentInstance;
        component.showLaps = false;
        component.showArrows = false;
        component.is3D = false;
        component.mapStyle = 'default';
        component.user = userMock;
        fixture.detectChanges();
        vi.clearAllMocks();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should use base menu panel class', () => {
        const templatePath = resolve(process.cwd(), 'src/app/components/event/map/map-actions/map.actions.component.html');
        const template = readFileSync(templatePath, 'utf8');
        expect(template).toContain('<mat-menu #layersMenu="matMenu" xPosition="before" class="qs-menu-panel">');
    });

    it('should toggle laps and emit state changes', async () => {
        const showLapsEmitSpy = vi.spyOn(component.showLapsChange, 'emit');
        const showArrowsEmitSpy = vi.spyOn(component.showArrowsChange, 'emit');
        const is3DEmitSpy = vi.spyOn(component.is3DChange, 'emit');
        const mapStyleEmitSpy = vi.spyOn(component.mapStyleChange, 'emit');

        await component.onShowLapsToggle(true);

        expect(component.showLaps).toBe(true);
        expect(showLapsEmitSpy).toHaveBeenCalledWith(true);
        expect(showArrowsEmitSpy).toHaveBeenCalledWith(false);
        expect(is3DEmitSpy).toHaveBeenCalledWith(false);
        expect(mapStyleEmitSpy).toHaveBeenCalledWith('default');
        expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_map_settings_change');
    });

    it('should emit when no user is available', async () => {
        component.user = null as unknown as User;

        const showLapsEmitSpy = vi.spyOn(component.showLapsChange, 'emit');
        const showArrowsEmitSpy = vi.spyOn(component.showArrowsChange, 'emit');
        const is3DEmitSpy = vi.spyOn(component.is3DChange, 'emit');
        const mapStyleEmitSpy = vi.spyOn(component.mapStyleChange, 'emit');

        await component.onShowArrowsToggle(true);

        expect(component.showArrows).toBe(true);
        expect(showLapsEmitSpy).toHaveBeenCalledWith(false);
        expect(showArrowsEmitSpy).toHaveBeenCalledWith(true);
        expect(is3DEmitSpy).toHaveBeenCalledWith(false);
        expect(mapStyleEmitSpy).toHaveBeenCalledWith('default');
        expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_map_settings_change');
    });

    it('should update map style and emit settings', async () => {
        const mapStyleEmitSpy = vi.spyOn(component.mapStyleChange, 'emit');

        await component.onMapStyleSelect('satellite');

        expect(component.mapStyle).toBe('satellite');
        expect(mapStyleEmitSpy).toHaveBeenCalledWith('satellite');
    });

    it('should update 3d setting and emit settings', async () => {
        const is3DEmitSpy = vi.spyOn(component.is3DChange, 'emit');

        await component.onShow3DToggle(true);

        expect(component.is3D).toBe(true);
        expect(is3DEmitSpy).toHaveBeenCalledWith(true);
    });
});
