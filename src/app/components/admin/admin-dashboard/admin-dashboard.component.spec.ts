import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminDashboardComponent } from './admin-dashboard.component';
import { AdminService } from '../../../services/admin.service';
import { LoggerService } from '../../../services/logger.service';

describe('AdminDashboardComponent', () => {
    let component: AdminDashboardComponent;
    let fixture: ComponentFixture<AdminDashboardComponent>;
    let adminServiceSpy: { getFinancialStats: ReturnType<typeof vi.fn> };

    const mockFinancialStats = {
        revenue: { total: 1000, currency: 'USD', invoiceCount: 10 },
        cost: {
            billingAccountId: null,
            projectId: 'quantified-self-io',
            reportUrl: 'https://example.com/report',
            currency: 'USD',
            total: 2500,
            budget: null
        }
    };

    beforeEach(async () => {
        adminServiceSpy = {
            getFinancialStats: vi.fn().mockReturnValue(of(mockFinancialStats))
        };

        await TestBed.configureTestingModule({
            imports: [AdminDashboardComponent],
            providers: [
                { provide: AdminService, useValue: adminServiceSpy },
                { provide: LoggerService, useValue: { error: vi.fn(), log: vi.fn() } },
                { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(AdminDashboardComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should load financial stats on init', () => {
        expect(adminServiceSpy.getFinancialStats).toHaveBeenCalled();
        expect(component.financialStats).toEqual(mockFinancialStats);
        expect(component.isLoadingFinancials).toBe(false);
    });

    it('should render dedicated queue route buttons', () => {
        const host: HTMLElement = fixture.nativeElement;
        const buttons = Array.from(host.querySelectorAll('button')).map((button) => button.textContent || '');

        expect(buttons.join(' ')).toContain('Workout Queue');
        expect(buttons.join(' ')).toContain('Reparse Queue');
    });

    it('should call fetchFinancialStats and update state', () => {
        vi.clearAllMocks();
        component.fetchFinancialStats();
        expect(adminServiceSpy.getFinancialStats).toHaveBeenCalled();
        expect(component.financialStats).toEqual(mockFinancialStats);
    });
});
