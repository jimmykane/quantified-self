import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { User } from '@sports-alliance/sports-lib';
import { vi } from 'vitest';
import { MapActionsComponent } from './map.actions.component';
import { AppUserService } from '../../../../services/app.user.service';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';

describe('MapActionsComponent', () => {
    let component: MapActionsComponent;
    let fixture: ComponentFixture<MapActionsComponent>;

    const userServiceMock = {
        updateUserProperties: vi.fn().mockResolvedValue(true),
    };

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
                MatIconModule,
                MatMenuModule,
                MatSlideToggleModule,
                MatTooltipModule,
            ],
            providers: [
                { provide: AppUserService, useValue: userServiceMock },
                { provide: AppAnalyticsService, useValue: analyticsServiceMock },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(MapActionsComponent);
        component = fixture.componentInstance;
        component.showLaps = false;
        component.showArrows = false;
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

    it('should toggle laps and persist settings', async () => {
        const showLapsEmitSpy = vi.spyOn(component.showLapsChange, 'emit');
        const showArrowsEmitSpy = vi.spyOn(component.showArrowsChange, 'emit');

        await component.onShowLapsToggle(true);

        expect(component.showLaps).toBe(true);
        expect(showLapsEmitSpy).toHaveBeenCalledWith(true);
        expect(showArrowsEmitSpy).toHaveBeenCalledWith(false);
        expect(userMock.settings.mapSettings.showLaps).toBe(true);
        expect(userServiceMock.updateUserProperties).toHaveBeenCalledWith(userMock, { settings: userMock.settings });
        expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_map_settings_change');
    });

    it('should emit without persisting when no user is available', async () => {
        component.user = null as unknown as User;

        const showLapsEmitSpy = vi.spyOn(component.showLapsChange, 'emit');
        const showArrowsEmitSpy = vi.spyOn(component.showArrowsChange, 'emit');

        await component.onShowArrowsToggle(true);

        expect(component.showArrows).toBe(true);
        expect(showLapsEmitSpy).toHaveBeenCalledWith(false);
        expect(showArrowsEmitSpy).toHaveBeenCalledWith(true);
        expect(userServiceMock.updateUserProperties).not.toHaveBeenCalled();
        expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('event_map_settings_change');
    });
});
