
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServicesComponent } from './services.component';
import { AppUserService } from '../../services/app.user.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { AppFileService } from '../../services/app.file.service';
import { AppEventService } from '../../services/app.event.service';
import { AppWindowService } from '../../services/app.window.service';
import { of } from 'rxjs';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

describe('ServicesComponent', () => {
    let component: ServicesComponent;
    let fixture: ComponentFixture<ServicesComponent>;
    let mockUserService: any;
    let mockAuthService: any;
    let mockRouter: any;
    let mockActivatedRoute: any;

    beforeEach(async () => {
        mockUserService = {
            isPro: vi.fn(),
            isAdmin: vi.fn()
        };

        mockAuthService = {
            user$: of(null)
        };

        mockRouter = {
            navigate: vi.fn()
        };

        mockActivatedRoute = {
            snapshot: {
                data: {},
                queryParamMap: {
                    get: vi.fn()
                }
            }
        };

        await TestBed.configureTestingModule({
            declarations: [ServicesComponent],
            imports: [HttpClientTestingModule, MatSnackBarModule],
            providers: [
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: AppFileService, useValue: {} },
                { provide: AppEventService, useValue: {} },
                { provide: AppWindowService, useValue: {} }
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ServicesComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should set isAdmin to true when userService returns true', async () => {
        mockUserService.isAdmin.mockReturnValue(Promise.resolve(true));
        mockActivatedRoute.snapshot.data['userData'] = { user: { uid: '123' }, isPro: true };

        // Trigger ngOnInit
        await component.ngOnInit();

        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(component.isAdmin).toBe(true);
    });

    it('should set isAdmin to false when userService returns false', async () => {
        mockUserService.isAdmin.mockReturnValue(Promise.resolve(false));
        mockActivatedRoute.snapshot.data['userData'] = { user: { uid: '123' }, isPro: true };

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(component.isAdmin).toBe(false);
    });
});
