
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServicesSuuntoComponent } from './services.suunto.component';
import { ServiceSyncingStateComponent } from '../../shared/service-syncing-state/service-syncing-state.component';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterTestingModule } from '@angular/router/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { AppFileService } from '../../../services/app.file.service';
import { Analytics } from '@angular/fire/analytics';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { LoggerService } from '../../../services/logger.service';
import { AppFunctionsService } from '../../../services/app.functions.service';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

describe('ServicesSuuntoComponent', () => {
    let component: ServicesSuuntoComponent;
    let fixture: ComponentFixture<ServicesSuuntoComponent>;
    let mockUserService: any;
    let mockFileService: any;
    let mockEventService: any;
    let mockFunctionsService: any;
    let mockSnackBar: any;

    beforeEach(async () => {
        mockUserService = {
            isAdmin: vi.fn(),
            requestAndSetCurrentUserSuuntoAppAccessToken: vi.fn(),
            getCurrentUserServiceTokenAndRedirectURI: vi.fn(),
        };
        mockFileService = {
            downloadFile: vi.fn(),
        };
        mockEventService = {
            writeAllEventData: vi.fn(),
        };
        mockFunctionsService = {
            call: vi.fn().mockResolvedValue({ data: { file: 'Zm9v' } }),
        };
        mockSnackBar = {
            open: vi.fn(),
        };

        await TestBed.configureTestingModule({
            declarations: [ServicesSuuntoComponent, ServiceSyncingStateComponent],
            imports: [
                MatCardModule,
                MatIconModule,
                HttpClientTestingModule,
                MatSnackBarModule,
                RouterTestingModule,
                ReactiveFormsModule
            ],
            providers: [
                { provide: AppFileService, useValue: mockFileService },
                { provide: Analytics, useValue: {} },
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppAuthService, useValue: { user$: { pipe: () => ({ subscribe: () => { } }) } } },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppWindowService, useValue: { currentDomain: 'http://localhost', windowRef: { location: { href: '' } } } },
                { provide: LoggerService, useValue: { error: vi.fn(), log: vi.fn() } },
                { provide: AppFunctionsService, useValue: mockFunctionsService },
                { provide: MatSnackBar, useValue: mockSnackBar },
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ServicesSuuntoComponent);
        component = fixture.componentInstance;
        component.suuntoAppLinkFormGroup = {
            valid: true,
            get: (field: string) => {
                if (field === 'input') {
                    return { valid: true, touched: true, value: 'https://www.suunto.com/activity/12345' };
                }
                return { valid: true, touched: true };
            },
        } as any; // Mock form
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should show syncing state when forceConnected is true but tokens are not yet loaded', () => {
        component.forceConnected = true;
        component.serviceTokens = undefined;
        component.hasProAccess = true;
        fixture.detectChanges();

        const syncingText = fixture.nativeElement.textContent;
        expect(syncingText).toContain('Syncing connection details...');

        const accountIcon = fixture.nativeElement.querySelector('mat-icon[matListItemIcon]');
        expect(accountIcon).toBeFalsy();
    });

    describe('History Import Card', () => {
        it('should be unlocked/available if user has pro access AND is connected', () => {
            component.hasProAccess = true;
            component.isAdmin = false;
            // Mock connected state
            component.serviceTokens = [{ accessToken: 'token' } as any];
            fixture.detectChanges();

            const card = fixture.nativeElement.querySelectorAll('.feature-card')[1]; // History import is the second card
            const historyForm = card.querySelector('app-history-import-form');

            expect(historyForm).toBeTruthy();
        });

        it('should show connect message if user has pro access but is NOT connected', () => {
            component.hasProAccess = true;
            component.serviceTokens = []; // Not connected
            fixture.detectChanges();

            const card = fixture.nativeElement.querySelectorAll('.feature-card')[1];
            const historyForm = card.querySelector('app-history-import-form');
            const cardContent = card.textContent;

            expect(historyForm).toBeFalsy();
            expect(cardContent).toContain('Connect Account First');
        });
    });

    describe('download flow', () => {
        it('should download FIT via callable and never write event data', async () => {
            component.user = { uid: 'u1' } as any;
            component.suuntoAppLinkFormGroup = {
                valid: true,
                get: (field: string) => {
                    if (field === 'input') {
                        return { value: 'https://www.suunto.com/activity/12345' };
                    }
                    return { valid: true, touched: true };
                },
            } as any;

            await component.onSubmit();

            expect(mockFunctionsService.call).toHaveBeenCalledWith('stWorkoutDownloadAsFit', { activityID: '12345' });
            expect(mockFileService.downloadFile).toHaveBeenCalledTimes(1);
            expect(mockEventService.writeAllEventData).not.toHaveBeenCalled();
            expect(component.isDownloading).toBe(false);
        });

        it('should no-op when a download is already in progress', async () => {
            component.suuntoAppLinkFormGroup = {
                valid: true,
                get: () => ({ value: 'https://www.suunto.com/activity/12345' }),
            } as any;
            component.isDownloading = true;

            const result = await component.onSubmit();

            expect(result).toBe(false);
            expect(mockFunctionsService.call).not.toHaveBeenCalled();
            expect(mockFileService.downloadFile).not.toHaveBeenCalled();
            expect(mockEventService.writeAllEventData).not.toHaveBeenCalled();
        });
    });
});
