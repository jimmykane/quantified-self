import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserSettingsComponent } from './user-settings.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppWindowService } from '../../services/app.window.service';
import { MatDialog } from '@angular/material/dialog';
import { LoggerService } from '../../services/logger.service';
import { Analytics } from '@angular/fire/analytics';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MaterialModule } from '../../modules/material.module';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { Privacy, User } from '@sports-alliance/sports-lib';



describe('UserSettingsComponent', () => {
    let component: UserSettingsComponent;
    let fixture: ComponentFixture<UserSettingsComponent>;

    const mockUser: Partial<User> = {
        uid: 'test-uid',
        displayName: 'Test User',
        settings: {
            chartSettings: {
                dataTypeSettings: {
                    'altitude': { enabled: true }
                },
                theme: 'material',
                downSamplingLevel: 4,
                strokeWidth: 2,
                gainAndLossThreshold: 1,
                strokeOpacity: 1,
                extraMaxForPower: 0,
                extraMaxForPace: 0,
                fillOpacity: 1,
                lapTypes: [],
                showLaps: true,
                showGrid: true,
                stackYAxes: true,
                xAxisType: 'time',
                useAnimations: true,
                hideAllSeriesOnInit: false,
                showAllData: true,
                disableGrouping: false,
                chartCursorBehaviour: 'zoomX'
            } as any,
            appSettings: { theme: 'normal' } as any,
            unitSettings: {
                speedUnits: [],
                paceUnits: [],
                swimPaceUnits: [],
                verticalSpeedUnits: [],
                startOfTheWeek: 1
            } as any,
            mapSettings: {
                theme: 'normal',
                mapType: 'roadmap',
                strokeWidth: 4,
                showLaps: true,
                showPoints: true,
                showArrows: true,
                lapTypes: []
            } as any,
            dashboardSettings: {
                tableSettings: {
                    eventsPerPage: 10
                }
            } as any,
            summariesSettings: {
                removeAscentForEventTypes: []
            } as any
        } as any
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [UserSettingsComponent],
            imports: [ReactiveFormsModule, MaterialModule, NoopAnimationsModule],
            providers: [
                { provide: AppAuthService, useValue: { user$: of(null) } },
                { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
                { provide: AppUserService, useValue: { isBranded: vi.fn().mockResolvedValue(false) } },
                { provide: Router, useValue: {} },
                { provide: MatSnackBar, useValue: {} },
                { provide: AppWindowService, useValue: {} },
                { provide: MatDialog, useValue: {} },
                { provide: LoggerService, useValue: {} },
                { provide: Analytics, useValue: {} },
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(UserSettingsComponent);
        component = fixture.componentInstance;
        component.user = mockUser as User;
        component.ngOnChanges(); // Initialize form before detectChanges
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should default privacy to Private if user.privacy is missing', () => {
        // mockUser has no privacy property
        component.ngOnChanges();
        expect(component.userSettingsFormGroup.get('privacy').value).toBe(Privacy.Private);
    });

    it('should use user.privacy if available', () => {
        component.user.privacy = Privacy.Public;
        component.ngOnChanges();
        expect(component.userSettingsFormGroup.get('privacy').value).toBe(Privacy.Public);
    });
});
