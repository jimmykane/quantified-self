import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminFinancialsComponent } from './admin-financials.component';
import { FinancialStats } from '../../../services/admin.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('AdminFinancialsComponent', () => {
    let component: AdminFinancialsComponent;
    let fixture: ComponentFixture<AdminFinancialsComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [AdminFinancialsComponent]
        }).compileComponents();

        fixture = TestBed.createComponent(AdminFinancialsComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('formatCurrency', () => {
        it('should format USD correctly', () => {
            expect(component.formatCurrency(1234, 'usd')).toContain('$12.34');
        });

        it('should format EUR correctly', () => {
            // Note: Locale output depends on system, but usually includes symbol
            const result = component.formatCurrency(1234, 'eur');
            expect(result).toMatch(/€12\.34|12\.34\s*€/);
        });

        it('should handle zero', () => {
            expect(component.formatCurrency(0, 'usd')).toContain('$0.00');
        });
    });

    describe('openExternalLink', () => {
        it('should open window if url is provided', () => {
            // Mock window.open
            vi.spyOn(window, 'open').mockImplementation(() => null);

            component.openExternalLink('https://example.com');
            expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank');
        });

        it('should not open window if url is null', () => {
            const spy = vi.spyOn(window, 'open');
            component.openExternalLink(null);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('Input binding', () => {
        it('should display revenue when stats are provided', () => {
            const mockStats: FinancialStats = {
                revenue: { total: 5000, currency: 'usd', invoiceCount: 10 },
                cost: {
                    total: 100,
                    currency: 'usd',
                    reportUrl: 'http://test',
                    billingAccountId: '123',
                    budget: { amount: 2000, currency: 'usd' }
                }
            };
            component.stats = mockStats;
            fixture.detectChanges();

            const element = fixture.nativeElement as HTMLElement;
            expect(element.textContent).toContain('$50.00');
            expect(element.textContent).toContain('from 10 paid invoices');
        });

        it('should show spinner when loading is true', () => {
            component.loading = true;
            fixture.detectChanges();
            const spinner = fixture.nativeElement.querySelector('mat-spinner');
            expect(spinner).toBeTruthy();
        });
    });
});
