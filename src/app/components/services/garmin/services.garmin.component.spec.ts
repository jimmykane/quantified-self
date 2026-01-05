
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServicesGarminComponent } from './services.garmin.component';
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
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

describe('ServicesGarminComponent', () => {
    let component: ServicesGarminComponent;
    let fixture: ComponentFixture<ServicesGarminComponent>;
    let mockUserService: any;

    beforeEach(async () => {
        mockUserService = {
            isAdmin: vi.fn(),
            requestAndSetCurrentUserGarminAccessToken: vi.fn()
        };

        await TestBed.configureTestingModule({
            declarations: [ServicesGarminComponent],
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
                { provide: AppEventService, useValue: {} },
                { provide: AppAuthService, useValue: { user$: { pipe: () => ({ subscribe: () => { } }) } } },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppWindowService, useValue: { currentDomain: 'http://localhost' } },
                { provide: LoggerService, useValue: { error: vi.fn(), log: vi.fn() } }
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ServicesGarminComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('History Import Card', () => {
        it('should be locked via PRO badge if user has no pro access', () => {
            component.hasProAccess = false;
            component.isAdmin = false;
            fixture.detectChanges();

            const card = fixture.nativeElement.querySelectorAll('.feature-card')[1]; // Second card is History Import
            const lockOverlay = card.querySelector('.lock-overlay');
            const badge = card.querySelector('.pro-badge');

            expect(card.classList).toContain('locked');
            expect(lockOverlay).toBeTruthy();
            expect(badge.textContent.trim()).toBe('PRO');
            expect(card.classList).not.toContain('coming-soon');
        });

        it('should be locked via COMING SOON badge if user has pro access but is not admin', () => {
            component.hasProAccess = true;
            component.isAdmin = false;
            fixture.detectChanges();

            const card = fixture.nativeElement.querySelectorAll('.feature-card')[1];
            const lockOverlay = card.querySelector('.lock-overlay');
            const badge = card.querySelector('.pro-badge');

            expect(card.classList).toContain('locked');
            expect(lockOverlay).toBeTruthy();
            expect(badge.textContent.trim()).toBe('COMING SOON');
            expect(card.classList).toContain('coming-soon');
        });

        it('should be unlocked if user has pro access and is admin', () => {
            component.hasProAccess = true;
            component.isAdmin = true;
            fixture.detectChanges();

            const card = fixture.nativeElement.querySelectorAll('.feature-card')[1];
            const lockOverlay = card.querySelector('.lock-overlay');

            expect(card.classList).toContain('unlocked');
            expect(lockOverlay).toBeFalsy();
        });
    });
});
