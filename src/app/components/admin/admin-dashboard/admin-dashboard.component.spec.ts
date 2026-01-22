import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminDashboardComponent } from './admin-dashboard.component';
import { AdminService } from '../../../services/admin.service';
import { LoggerService } from '../../../services/logger.service';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { Auth } from '@angular/fire/auth';
import { FirebaseApp } from '@angular/fire/app';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { BehaviorSubject } from 'rxjs';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

// Mock canvas for charts
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => ({
        fillRect: () => { },
        clearRect: () => { },
        getImageData: () => ({ data: [] }),
        putImageData: () => { },
        createImageData: () => [],
        setTransform: () => { },
        save: () => { },
        restore: () => { },
        beginPath: () => { },
        moveTo: () => { },
        lineTo: () => { },
        clip: () => { },
        fill: () => { },
        stroke: () => { },
        rect: () => { },
        arc: () => { },
        quadraticCurveTo: () => { },
        closePath: () => { },
        translate: () => { },
        rotate: () => { },
        scale: () => { },
        fillText: () => { },
        strokeText: () => { },
        measureText: () => ({ width: 0 }),
        drawImage: () => { },
        canvas: { width: 0, height: 0, style: {} }
    }),
    configurable: true
});

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

describe('AdminDashboardComponent', () => {
    let component: AdminDashboardComponent;
    let fixture: ComponentFixture<AdminDashboardComponent>;
    let adminServiceSpy: any;
    let mockLogger: any;

    const mockQueueStats = {
        pending: 10,
        succeeded: 20,
        stuck: 5,
        providers: [],
        cloudTasks: { pending: 42 },
        advanced: { throughput: 0, maxLagMs: 0, retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 }, topErrors: [] }
    };

    const mockFinancialStats = {
        revenue: { total: 1000, currency: 'USD', invoiceCount: 10 },
        cost: { reportUrl: 'http://test.com' }
    };

    beforeEach(async () => {
        adminServiceSpy = {
            getQueueStats: vi.fn().mockReturnValue(of(mockQueueStats)),
            getFinancialStats: vi.fn().mockReturnValue(of(mockFinancialStats)),
        };

        mockLogger = {
            error: vi.fn(),
            log: vi.fn()
        };

        await TestBed.configureTestingModule({
            imports: [
                AdminDashboardComponent,
                NoopAnimationsModule
            ],
            providers: [
                { provide: AdminService, useValue: adminServiceSpy },
                { provide: LoggerService, useValue: mockLogger },
                { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
                { provide: Firestore, useValue: {} },
                { provide: Storage, useValue: {} },
                { provide: Auth, useValue: {} },
                { provide: FirebaseApp, useValue: {} },
                { provide: AppThemeService, useValue: { getAppTheme: () => new BehaviorSubject<AppThemes>(AppThemes.Dark).asObservable() } },
                provideCharts(withDefaultRegisterables())
            ],
            schemas: [NO_ERRORS_SCHEMA]
        }).compileComponents();

        fixture = TestBed.createComponent(AdminDashboardComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should load queue stats on init', () => {
        expect(adminServiceSpy.getQueueStats).toHaveBeenCalled();
        expect(component.queueStats).toEqual(mockQueueStats);
        expect(component.isLoadingStats).toBe(false);
    });

    it('should load financial stats on init', () => {
        expect(adminServiceSpy.getFinancialStats).toHaveBeenCalled();
        expect(component.financialStats).toEqual(mockFinancialStats);
        expect(component.isLoadingFinancials).toBe(false);
    });

    describe('Queue Stats', () => {
        it('should call fetchQueueStats and update state', () => {
            vi.clearAllMocks();
            component.fetchQueueStats();
            expect(adminServiceSpy.getQueueStats).toHaveBeenCalledWith(true);
            expect(component.queueStats).toEqual(mockQueueStats);
        });
    });

    describe('Financial Stats', () => {
        it('should call fetchFinancialStats and update state', () => {
            vi.clearAllMocks();
            component.fetchFinancialStats();
            expect(adminServiceSpy.getFinancialStats).toHaveBeenCalled();
            expect(component.financialStats).toEqual(mockFinancialStats);
        });
    });
});
