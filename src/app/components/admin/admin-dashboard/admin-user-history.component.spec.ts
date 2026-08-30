import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppThemes } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminDashboardHistoryPoint, AdminDashboardHistoryResponse } from '../../../services/admin.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import { AdminUserHistoryComponent } from './admin-user-history.component';

describe('AdminUserHistoryComponent', () => {
    let fixture: ComponentFixture<AdminUserHistoryComponent>;
    let component: AdminUserHistoryComponent;
    let restoreDateNow: () => void;
    let loader: {
        init: ReturnType<typeof vi.fn>;
        setOption: ReturnType<typeof vi.fn>;
        resize: ReturnType<typeof vi.fn>;
        dispose: ReturnType<typeof vi.fn>;
        subscribeToViewportResize: ReturnType<typeof vi.fn>;
        attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        const dateNowSpy = vi.spyOn(Date, 'now')
            .mockReturnValue(Date.parse('2026-08-27T12:00:00.000Z'));
        restoreDateNow = () => dateNowSpy.mockRestore();
        const chart = {
            isDisposed: vi.fn().mockReturnValue(false),
            dispatchAction: vi.fn(),
        };
        loader = {
            init: vi.fn().mockResolvedValue(chart),
            setOption: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn(),
            subscribeToViewportResize: vi.fn(() => () => { }),
            attachMobileSeriesTapFeedback: vi.fn(() => () => { }),
        };

        await TestBed.configureTestingModule({
            imports: [AdminUserHistoryComponent],
            providers: [
                { provide: AppThemeService, useValue: { getAppTheme: () => of(AppThemes.Normal) } },
                { provide: EChartsLoaderService, useValue: loader },
                { provide: LoggerService, useValue: { error: vi.fn() } },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AdminUserHistoryComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        restoreDateNow();
    });

    it('shows collection progress until eight selected-range snapshots exist', () => {
        fixture.componentRef.setInput('history', history(7));
        fixture.detectChanges();

        const text = (fixture.nativeElement as HTMLElement).textContent || '';
        expect(text).toContain('Collecting daily history');
        expect(text).toContain('7 of 8 snapshots');
        expect(loader.init).not.toHaveBeenCalled();
    });

    it('renders four focused charts once enough current daily snapshots exist', async () => {
        fixture.componentRef.setInput('history', history(8));
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(4));

        const text = (fixture.nativeElement as HTMLElement).textContent || '';
        expect(text).toContain('Authentication activity');
        expect(text).toContain('Active users by plan');
        expect(text).toContain('User and plan mix');
        expect(text).toContain('Paid subscription cadence');
        expect(text).toContain('History is current');
        expect(text).toContain('1y');

        const chartElements = (fixture.nativeElement as HTMLElement).querySelectorAll('.history-chart[role="img"]');
        expect(chartElements).toHaveLength(4);
        chartElements.forEach(element => expect(element.getAttribute('aria-label')).toBeTruthy());

        const options = loader.setOption.mock.calls.map(call => call[1] as {
            series?: Array<{
                name?: string;
                symbol?: string;
                lineStyle?: { type?: string };
                areaStyle?: { opacity?: number };
            }>;
        });
        const activityOption = options.find(option => option.series?.some(series => series.name === 'Active 24h'));
        expect(activityOption?.series?.map(series => series.lineStyle?.type)).toEqual([
            'solid',
            'dashed',
            'dotted',
        ]);
        expect(activityOption?.series?.map(series => series.symbol)).toEqual([
            'circle',
            'diamond',
            'triangle',
        ]);

        const activePlanOption = options.find(option => option.series?.some(series => (
            (series as { id?: string }).id === 'active-plan-free'
        )));
        expect(activePlanOption?.series?.map(series => series.name)).toEqual(['Free', 'Basic', 'Pro']);

        const userMixOption = options.find(option => option.series?.some(series => series.name === 'Onboarding complete'));
        expect(new Set(userMixOption?.series?.slice(0, 3).map(series => series.areaStyle?.opacity)).size).toBe(3);
    });

    it('switches the active-plan rolling window locally', async () => {
        fixture.componentRef.setInput('history', history(8));
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(4));

        component.selectActivePlanWindow('last24Hours');
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption.mock.calls.length).toBeGreaterThanOrEqual(8));

        const activePlanOption = loader.setOption.mock.calls
            .map(call => call[1] as { series?: Array<{ id?: string; data?: Array<number | null> }> })
            .filter(option => option.series?.some(series => series.id === 'active-plan-free'))
            .at(-1);
        const proData = activePlanOption?.series?.find(series => series.id === 'active-plan-pro')?.data;
        expect(component.selectedActivePlanWindow()).toBe('last24Hours');
        expect(proData?.filter(value => value !== null)).toEqual(Array(8).fill(0));
    });

    it('keeps legacy charts visible while current plan history collects', async () => {
        const legacyHistory = history(8);
        legacyHistory.snapshots.forEach(snapshot => { snapshot.authActivity.byPlan = null; });
        fixture.componentRef.setInput('history', legacyHistory);
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(3));

        const text = (fixture.nativeElement as HTMLElement).textContent || '';
        expect(text).toContain('0 of 8 plan snapshots');
        expect(text).toContain('Legacy snapshots remain in the other charts');
        expect((fixture.nativeElement as HTMLElement).querySelectorAll('.history-chart[role="img"]')).toHaveLength(3);
    });

    it('keeps unknown cadence series hidden until an unknown value occurs', async () => {
        fixture.componentRef.setInput('history', history(8));
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(4));

        let cadenceOption = loader.setOption.mock.calls
            .map(call => call[1] as { series?: Array<{ name?: string }> })
            .find(option => option.series?.some(series => series.name === 'Pro monthly'));
        expect(cadenceOption?.series?.map(series => series.name)).not.toContain('Pro unknown');

        const withUnknown = history(8);
        withUnknown.snapshots[3].subscriptionCadence.pro = { monthly: 1, yearly: 0, unknown: 1 };
        fixture.componentRef.setInput('history', withUnknown);
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption.mock.calls.length).toBeGreaterThanOrEqual(8));

        cadenceOption = loader.setOption.mock.calls
            .map(call => call[1] as {
                series?: Array<{ name?: string }>;
                tooltip?: { formatter?: (params: unknown) => string };
            })
            .filter(option => option.series?.some(series => series.name === 'Pro monthly'))
            .at(-1);
        expect(cadenceOption?.series?.map(series => series.name)).toContain('Pro unknown');
        expect(cadenceOption?.series?.map(series => series.name)).not.toContain('Basic unknown');

        const tooltip = cadenceOption?.tooltip?.formatter?.([{
            axisValue: withUnknown.snapshots[3].date,
        }]);
        expect(tooltip).toContain('Pro unknown');
        expect(tooltip).not.toContain('Basic unknown');
    });

    it('switches ranges locally without requesting new data', async () => {
        fixture.componentRef.setInput('history', history(40));
        fixture.detectChanges();
        await fixture.whenStable();

        component.selectDays(30);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.selectedDays()).toBe(30);
        expect(component.historyView().availablePoints).toBe(30);
    });

    it('disposes every initialized chart host', async () => {
        fixture.componentRef.setInput('history', history(8));
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(4));

        const disposeCallsBeforeDestroy = loader.dispose.mock.calls.length;
        component.ngOnDestroy();

        expect(loader.dispose.mock.calls.length - disposeCallsBeforeDestroy).toBe(4);
    });
});

function history(count: number): AdminDashboardHistoryResponse {
    const endDateMs = Date.parse('2026-08-27T00:00:00.000Z');
    return {
        days: 365,
        startDate: '2025-08-28',
        endDate: '2026-08-27',
        snapshots: Array.from({ length: count }, (_, index) => {
            const offset = count - index - 1;
            return point(new Date(endDateMs - (offset * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10));
        }),
    };
}

function point(date: string): AdminDashboardHistoryPoint {
    return {
        date,
        computedAt: `${date}T00:12:00.000Z`,
        users: { total: 10, free: 5, basic: 3, pro: 2, onboardingCompleted: 7 },
        authActivity: {
            eligibleAccounts: 9,
            last24Hours: 2,
            last7Days: 5,
            last30Days: 8,
            byPlan: {
                free: { last24Hours: 1, last7Days: 3, last30Days: 4 },
                basic: { last24Hours: 1, last7Days: 1, last30Days: 3 },
                pro: { last24Hours: 0, last7Days: 1, last30Days: 1 },
            },
        },
        subscriptionCadence: {
            pro: { monthly: 1, yearly: 1, unknown: 0 },
            basic: { monthly: 2, yearly: 1, unknown: 0 },
        },
    };
}
