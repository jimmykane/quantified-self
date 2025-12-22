import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventCardComponent } from './event.card.component';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { AppActivitySelectionService } from '../../services/activity-selection-service/app-activity-selection.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppThemeService } from '../../services/app.theme.service';
import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { EventInterface, User, ActivityInterface } from '@sports-alliance/sports-lib';

describe('EventCardComponent', () => {
    let component: EventCardComponent;
    let fixture: ComponentFixture<EventCardComponent>;

    let mockActivatedRoute: any;
    let mockAuthService: any;
    let mockUserService: any;
    let mockActivitySelectionService: any;
    let mockSnackBar: any;
    let mockThemeService: any;
    let mockRouter: any;

    const mockUser = new User('testUser');
    mockUser.settings = {
        unitSettings: {},
        chartSettings: {
            xAxisType: 'Duration',
            chartCursorBehaviour: 'Zoom'
        },
        mapSettings: {}
    } as any;

    const mockEvent = {
        getActivities: () => [{ getID: () => 'act1' }],
        getID: () => 'evt1'
    } as unknown as EventInterface;

    beforeEach(async () => {
        mockActivatedRoute = {
            data: of({ event: mockEvent }),
            snapshot: {
                paramMap: {
                    get: (key: string) => (key === 'userID' ? 'testUser' : null)
                }
            }
        };

        mockAuthService = {
            user$: of(mockUser)
        };

        mockUserService = {
            getUserChartDataTypesToUse: jasmine.createSpy('getUserChartDataTypesToUse').and.returnValue(['speed']),
            // Mock static methods if used in template or standard usage, though static methods are hard to mock directly with jasmine spies without wrappers
        };

        mockActivitySelectionService = {
            selectedActivities: {
                clear: jasmine.createSpy('clear'),
                select: jasmine.createSpy('select'),
                changed: {
                    asObservable: () => of({ source: { selected: [] } })
                }
            }
        };

        mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);

        mockThemeService = {
            getChartTheme: () => of('Light'),
            getAppTheme: () => of('Light'),
            getMapTheme: () => of('Light')
        };

        mockRouter = jasmine.createSpyObj('Router', ['navigate']);

        await TestBed.configureTestingModule({
            declarations: [EventCardComponent],
            providers: [
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppActivitySelectionService, useValue: mockActivitySelectionService },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: AppThemeService, useValue: mockThemeService },
                { provide: Router, useValue: mockRouter }
            ],
            schemas: [NO_ERRORS_SCHEMA]
        })
            .compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(EventCardComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should initialize event from route data', () => {
        expect(component.event).toBe(mockEvent);
        expect(mockActivitySelectionService.selectedActivities.clear).toHaveBeenCalled();
        expect(mockActivitySelectionService.selectedActivities.select).toHaveBeenCalled();
    });

    it('should set targetUserID from route', () => {
        expect(component.targetUserID).toBe('testUser');
    });

    it('should update settings from auth user', () => {
        expect(component.currentUser).toBe(mockUser);
        expect(component.chartXAxisType).toBe('Duration' as any);
    });
});
