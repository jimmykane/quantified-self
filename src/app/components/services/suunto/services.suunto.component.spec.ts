
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServicesSuuntoComponent } from './services.suunto.component';
import { ServiceSyncingStateComponent } from '../../shared/service-syncing-state/service-syncing-state.component';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { RouterTestingModule } from '@angular/router/testing';
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

    beforeEach(async () => {
        mockUserService = {
            isAdmin: vi.fn(),
            requestAndSetCurrentUserSuuntoAppAccessToken: vi.fn(),
            getCurrentUserServiceTokenAndRedirectURI: vi.fn(),
        };

        await TestBed.configureTestingModule({
            declarations: [ServicesSuuntoComponent, ServiceSyncingStateComponent],
            imports: [
                MatCardModule,
                MatIconModule,
                HttpClientTestingModule,
                MatSnackBarModule,
                RouterTestingModule
            ],
            providers: [
                { provide: AppFileService, useValue: {} },
                { provide: Analytics, useValue: {} },
                { provide: AppEventService, useValue: {} },
                { provide: AppAuthService, useValue: { user$: { pipe: () => ({ subscribe: () => { } }) } } },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppWindowService, useValue: { currentDomain: 'http://localhost', windowRef: { location: { href: '' } } } },
                { provide: LoggerService, useValue: { error: vi.fn(), log: vi.fn() } },
                { provide: AppFunctionsService, useValue: { call: vi.fn().mockResolvedValue({ data: { file: '' } }) } }
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ServicesSuuntoComponent);
        component = fixture.componentInstance;
        component.suuntoAppLinkFormGroup = { get: () => ({ valid: true, touched: true }) } as any; // Mock form
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
});
