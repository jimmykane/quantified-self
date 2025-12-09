import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppComponent } from './app.component';
import { AppAuthService } from './authentication/app.auth.service';
import { AppSideNavService } from './services/side-nav/app-side-nav.service';
import { MatIconRegistry } from '@angular/material/icon';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Router, RouterModule } from '@angular/router';
import { DomSanitizer, Title } from '@angular/platform-browser';
import { of, Subject } from 'rxjs';
import { MatSidenavModule } from '@angular/material/sidenav';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ChangeDetectorRef, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

// Mock the service module to avoid loading dependencies like rxfire
vi.mock('./authentication/app.auth.service', () => {
    return {
        AppAuthService: class {
            user$ = of(null);
        }
    };
});

describe('AppComponent', () => {
    let component: AppComponent;
    let fixture: ComponentFixture<AppComponent>;

    const mockAppAuthService = {
        user$: of(null)
    };

    const mockRouter = {
        events: new Subject(),
        navigate: vi.fn()
    };

    const mockAppSideNavService = {
        setSidenav: vi.fn()
    };

    const mockMatIconRegistry = {
        addSvgIcon: vi.fn()
    };

    const mockDomSanitizer = {
        bypassSecurityTrustResourceUrl: vi.fn()
    };

    const mockTitleService = {
        setTitle: vi.fn()
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [AppComponent],
            imports: [
                MatSidenavModule,
                NoopAnimationsModule,
                RouterModule
            ],
            providers: [
                { provide: AppAuthService, useValue: mockAppAuthService },
                { provide: Router, useValue: mockRouter },
                { provide: AppSideNavService, useValue: mockAppSideNavService },
                { provide: MatIconRegistry, useValue: mockMatIconRegistry },
                { provide: DomSanitizer, useValue: mockDomSanitizer },
                { provide: Title, useValue: mockTitleService },
                ChangeDetectorRef
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();

        fixture = TestBed.createComponent(AppComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
