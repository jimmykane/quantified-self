import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppThemes } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminDashboardHistoryPoint, AdminDashboardHistoryResponse } from '../../../services/admin.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import { AdminUserHistoryComponent } from './admin-user-history.component';

describe('AdminUserHistoryComponent', () => {
    let fixture: ComponentFixture<AdminUserHistoryComponent>;
    let component: AdminUserHistoryComponent;
    const haptics = { selection: vi.fn() };
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
        haptics.selection.mockClear();
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
                { provide: AppHapticsService, useValue: haptics },
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
        vi.unstubAllGlobals();
    });

    it('shows collection progress until eight selected-range snapshots exist', () => {
        fixture.componentRef.setInput('history', history(7));
        fixture.detectChanges();

        const text = (fixture.nativeElement as HTMLElement).textContent || '';
        expect(text).toContain('Collecting daily history');
        expect(text).toContain('7 of 8 snapshots');
        expect(loader.init).not.toHaveBeenCalled();
    });

    it.each([true, false])('renders each chart once when enough snapshots exist (ResizeObserver: %s)', async hasResizeObserver => {
        vi.stubGlobal('ResizeObserver', hasResizeObserver ? class {
            observe = vi.fn();
            disconnect = vi.fn();
        } : undefined);
        fixture.componentRef.setInput('history', history(8));
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(5));
        expect(loader.init).toHaveBeenCalledTimes(5);

        const text = (fixture.nativeElement as HTMLElement).textContent || '';
        expect(text).toContain('Authentication activity');
        expect(text).toContain('Active users by plan');
        expect(text).toContain('User and plan mix');
        expect(text).toContain('Paid subscription cadence');
        expect(text).toContain('History is current');
        expect(text).toContain('1y');

        const chartElements = (fixture.nativeElement as HTMLElement).querySelectorAll('.history-chart[role="img"]');
        expect(chartElements).toHaveLength(5);
        chartElements.forEach(element => expect(element.getAttribute('aria-label')).toBeTruthy());

        const options = loader.setOption.mock.calls.map(call => call[1] as {
            series?: Array<{
                name?: string;
                symbol?: string;
                lineStyle?: { type?: string };
                areaStyle?: { opacity?: number };
                stack?: string;
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

        const userMixOption = options.find(option => option.series?.some(series => (series as { id?: string }).id === 'user-plan-free'));
        expect(userMixOption?.series).toHaveLength(3);
        options.flatMap(option => option.series ?? []).forEach(series => {
            expect(series.stack).toBeUndefined();
            expect(series.areaStyle).toBeUndefined();
        });
        expect(haptics.selection).not.toHaveBeenCalled();
        expect((fixture.nativeElement as HTMLElement).querySelectorAll('mat-chip-listbox')).toHaveLength(4);
    });

    it('switches the active-plan rolling window locally', async () => {
        fixture.componentRef.setInput('history', history(8));
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(5));

        component.selectActivePlanWindow('last24Hours');
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption.mock.calls.length).toBeGreaterThanOrEqual(10));

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
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(4));

        const text = (fixture.nativeElement as HTMLElement).textContent || '';
        expect(text).toContain('0 of 8 plan snapshots');
        expect(text).toContain('Legacy snapshots remain in the other charts');
        expect((fixture.nativeElement as HTMLElement).querySelectorAll('.history-chart[role="img"]')).toHaveLength(4);
    });

    it('keeps unknown cadence series hidden until an unknown value occurs', async () => {
        fixture.componentRef.setInput('history', history(8));
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(5));

        let cadenceOption = loader.setOption.mock.calls
            .map(call => call[1] as { series?: Array<{ name?: string }> })
            .find(option => option.series?.some(series => series.name === 'Pro monthly'));
        expect(cadenceOption?.series?.map(series => series.name)).not.toContain('Pro unknown');

        const withUnknown = history(8);
        withUnknown.snapshots[3].subscriptionCadence.pro = { monthly: 1, yearly: 0, unknown: 1 };
        fixture.componentRef.setInput('history', withUnknown);
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption.mock.calls.length).toBeGreaterThanOrEqual(10));

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

    it('fits the visible series, formats exact counts, and keeps tooltip selections in sync', async () => {
        const data = history(40);
        data.snapshots.forEach((snapshot, index) => {
            snapshot.users = {
                total: 2100 + index,
                free: 1980 + index,
                basic: 10,
                pro: 110,
                onboardingCompleted: 1960 + index,
            };
        });
        fixture.componentRef.setInput('history', data);
        await renderCharts();

        component.selectSeries('userMix', ['Free']);
        await renderCharts();
        const selected = latestOption('Free');
        expect(selected.yAxis.min).toBeGreaterThan(1900);
        expect(selected.yAxis.min).toBeLessThan(1980);
        expect(selected.yAxis.max).toBeGreaterThan(2019);
        expect(selected.yAxis.max - selected.yAxis.min).toBeLessThan(100);
        expect(selected.yAxis.axisLabel.formatter(1980)).toBe('1,980');
        expect(selected.yAxis.axisLabel.formatter(2000)).toBe('2,000');
        expect(selected.legend).toMatchObject({
            show: false,
            selected: { Free: true, Basic: false, Pro: false },
        });
        const tooltip = selected.tooltip.formatter([{ axisValue: data.endDate }]);
        expect(tooltip).toContain('Free');
        expect(tooltip).not.toContain('Onboarding complete');
        expect(tooltip).not.toContain('Basic');
        expect(tooltip).not.toContain('Pro');

        component.selectDays(30);
        component.selectActivePlanWindow('last24Hours');
        await renderCharts();
        expect(latestOption('Free').legend.selected).toEqual(selected.legend.selected);
        expect(latestOption('Free').series[0].data).toHaveLength(30);

        component.selectScale('zero');
        await renderCharts();
        expect(latestOption('Free').yAxis.min).toBe(0);
        expect(latestOption('Free').legend.selected).toEqual(selected.legend.selected);
    });

    it('lets the Material chips filter and restore series without hiding the last one', async () => {
        fixture.componentRef.setInput('history', history(8));
        await renderCharts();
        const picker = (fixture.nativeElement as HTMLElement)
            .querySelector('mat-chip-listbox[aria-label="authentication activity series"]')!;
        const option = (label: string) => Array.from(picker.querySelectorAll<HTMLElement>('[role="option"]'))
            .find(element => element.textContent?.includes(label))!;

        option('Active 7d').click();
        await renderCharts();
        option('Active 30d').click();
        await renderCharts();

        expect(component.seriesControls().activity.selected).toEqual(['Active 24h']);
        expect(option('Active 24h').getAttribute('aria-disabled')).toBe('true');
        expect(option('Active 24h').getAttribute('aria-selected')).toBe('true');
        expect(latestOption('Active 24h').legend.selected)
            .toEqual({ 'Active 24h': true, 'Active 7d': false, 'Active 30d': false });
        expect(haptics.selection).toHaveBeenCalledTimes(2);

        const reset = (fixture.nativeElement as HTMLElement)
            .querySelector<HTMLButtonElement>('button[aria-label="Show all authentication activity series"]')!;
        expect(reset.disabled).toBe(false);
        reset.click();
        await renderCharts();
        expect(component.seriesControls().activity.selected).toHaveLength(3);
        expect(reset.disabled).toBe(true);
        expect(haptics.selection).toHaveBeenCalledTimes(3);
    });

    it('keeps initialization, invalid selections, and unchanged selections silent', async () => {
        fixture.componentRef.setInput('history', history(8));
        await renderCharts();
        const calls = loader.setOption.mock.calls.length;
        component.selectDays(90);
        component.selectDays(0 as never);
        component.selectActivePlanWindow('last30Days');
        component.selectActivePlanWindow('invalid' as never);
        component.selectScale('auto');
        component.selectScale('invalid' as never);
        component.selectSeries('activity', ['Active 30d', 'Active 24h', 'Active 7d']);
        component.selectSeries('activity', []);
        component.selectSeries('activity', ['unknown']);
        await fixture.whenStable();
        expect(haptics.selection).not.toHaveBeenCalled();
        expect(loader.setOption.mock.calls).toHaveLength(calls);

        component.selectDays(30);
        component.selectActivePlanWindow('last7Days');
        component.selectScale('zero');
        component.selectSeries('activity', ['Active 7d']);
        await renderCharts();
        expect(haptics.selection).toHaveBeenCalledTimes(4);
    });

    it('restores available cadence series when the selected unknown series leaves the range', async () => {
        const data = history(40);
        data.snapshots[0].subscriptionCadence.pro.unknown = 1;
        fixture.componentRef.setInput('history', data);
        await renderCharts();
        component.selectSeries('cadence', ['Pro unknown']);
        await renderCharts();
        expect(component.seriesControls().cadence.selected).toEqual(['Pro unknown']);

        component.selectDays(30);
        await renderCharts();
        expect(component.seriesControls().cadence.allSelected).toBe(true);
        expect(component.seriesControls().cadence.selected).toHaveLength(4);
        expect(latestOption('Pro monthly').series.map(series => series.name)).not.toContain('Pro unknown');
        expect(haptics.selection).toHaveBeenCalledTimes(2);
    });

    it('preserves collection gaps when fitting a single series', async () => {
        const data = history(9);
        data.snapshots.splice(4, 1);
        fixture.componentRef.setInput('history', data);
        component.selectSeries('activity', ['Active 30d']);
        await renderCharts();
        const option = latestOption('Active 30d');
        expect(option.yAxis.min).toBeGreaterThan(0);
        option.series.forEach(series => {
            expect(series.data[4]).toBeNull();
            expect(series.connectNulls).toBe(false);
        });
    });

    it('switches through Material controls and keeps percentages independent of hidden series', async () => {
        fixture.componentRef.setInput('history', history(8));
        await renderCharts();
        const toggle = (fixture.nativeElement as HTMLElement).querySelector('mat-button-toggle-group[aria-label="User history values"]')!;
        const percentageButton = Array.from(toggle.querySelectorAll('button')).find(button => button.textContent?.includes('Percentage'))!;
        percentageButton.click();
        await renderCharts();
        expect(component.selectedMode()).toBe('percentage');
        expect(haptics.selection).toHaveBeenCalledTimes(1);
        expect(latestOption('Active 24h').series[0].data[0]).toBeCloseTo(2 / 9 * 100);
        expect(latestOption('Free').series[0].data[0]).toBe(50);
        expect(latestOption('Free').yAxis.axisLabel.formatter(0.5)).toBe('0.5%');
        const onboarding = latestOption('Onboarding complete');
        expect(onboarding.series).toHaveLength(1);
        expect(onboarding.series[0].data[0]).toBe(70);
        expect(onboarding.tooltip.formatter([{ axisValue: '2026-08-27' }])).toContain('70% · 7 of 10 total users');

        const before = latestOption('Pro monthly').series[0].data;
        component.selectSeries('cadence', ['Pro monthly']);
        await renderCharts();
        expect(latestOption('Pro monthly').series[0].data).toEqual(before);
        expect(before[0]).toBe(50);
        const tooltip = latestOption('Pro monthly').tooltip.formatter([{ axisValue: '2026-08-27' }]);
        expect(tooltip).toContain('50% · 1 of 2 Pro users');
        expect(tooltip).not.toContain('Pro yearly');

        component.selectScale('zero');
        await renderCharts();
        expect(latestOption('Free').yAxis).toMatchObject({ min: 0, max: 100 });
        expect((fixture.nativeElement as HTMLElement).querySelector('[aria-label*="percentages of total users"]')?.getAttribute('aria-label')).toContain('percentage');
    });

    it('distinguishes within-plan activity rates from shares and preserves the rolling window', async () => {
        fixture.componentRef.setInput('history', history(8));
        component.selectMode('percentage');
        await renderCharts();
        const activePlanOption = () => loader.setOption.mock.calls.map(call => call[1] as {
            series: Array<{ id: string; data: number[] }>;
            tooltip: { formatter: (params: unknown) => string };
        }).filter(option => option.series.some(series => series.id === 'active-plan-pro')).at(-1)!;
        expect(activePlanOption().series[2].data[0]).toBe(50);
        expect(activePlanOption().tooltip.formatter([{ axisValue: '2026-08-27' }])).toContain('1 of 2 eligible Pro accounts');
        component.selectActivePlanBasis('activeShare');
        await renderCharts();
        expect(activePlanOption().series[2].data[0]).toBe(12.5);
        expect(activePlanOption().tooltip.formatter([{ axisValue: '2026-08-27' }])).toContain('1 of 8 active accounts');
        component.selectActivePlanWindow('last7Days');
        await renderCharts();
        expect(activePlanOption().series[2].data[0]).toBe(20);
        component.selectMode('count');
        await renderCharts();
        expect(activePlanOption().series[2].data[0]).toBe(1);
    });

    it('offers historical counts and active shares while eligible plan history collects', async () => {
        const data = history(8);
        data.snapshots.forEach(snapshot => { snapshot.authActivity.eligibleByPlan = null; });
        fixture.componentRef.setInput('history', data);
        component.selectMode('percentage');
        await renderCharts(4);
        expect(component.activePlanHistoryPoints()).toBe(0);
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('Use Count or Share of active users for older snapshots');
        component.selectActivePlanBasis('activeShare');
        await renderCharts();
        expect(component.activePlanHistoryPoints()).toBe(8);
        component.selectMode('count');
        component.selectActivePlanBasis('withinPlan');
        await renderCharts();
        expect(component.activePlanHistoryPoints()).toBe(8);
    });

    it('keeps missing days and empty denominators as gaps in percentage mode', async () => {
        const data = history(10);
        data.snapshots.splice(4, 1);
        data.snapshots[2].users = { total: 0, free: 0, basic: 0, pro: 0, onboardingCompleted: 0 };
        data.snapshots[1].authActivity.eligibleByPlan = null;
        fixture.componentRef.setInput('history', data);
        component.selectMode('percentage');
        await renderCharts();
        expect(latestOption('Onboarding complete').series[0].data[2]).toBeNull();
        expect(latestOption('Onboarding complete').series[0].data[4]).toBeNull();
        expect(latestOption('Onboarding complete').tooltip.formatter([{ axisValue: data.snapshots[2].date }])).toContain('Percentage unavailable');
        const active = loader.setOption.mock.calls.map(call => call[1] as { series: Array<{ id: string; data: Array<number | null>; connectNulls: boolean }> })
            .filter(option => option.series.some(series => series.id === 'active-plan-pro')).at(-1)!;
        expect(active.series[2].data[1]).toBeNull();
        expect(active.series[2].connectNulls).toBe(false);
    });

    it('exposes the plan basis only for percentages and preserves it through count mode', async () => {
        fixture.componentRef.setInput('history', history(8));
        await renderCharts();
        const basisControl = () => (fixture.nativeElement as HTMLElement).querySelector('[aria-label="Active plan percentage basis"]');
        expect(basisControl()).toBeNull();
        component.selectActivePlanBasis('activeShare');
        expect(component.selectedActivePlanBasis()).toBe('withinPlan');
        expect(haptics.selection).not.toHaveBeenCalled();

        const percentageButton = (fixture.nativeElement as HTMLElement).querySelector('mat-button-toggle[value="percentage"] button') as HTMLButtonElement;
        percentageButton.click();
        await renderCharts();
        expect(basisControl()).not.toBeNull();
        const shareButton = basisControl()!.querySelector('mat-button-toggle[value="activeShare"] button') as HTMLButtonElement;
        shareButton.click();
        await renderCharts();
        expect(component.selectedActivePlanBasis()).toBe('activeShare');
        expect(haptics.selection).toHaveBeenCalledTimes(2);

        component.selectMode('count');
        await renderCharts();
        expect(basisControl()).toBeNull();
        component.selectMode('percentage');
        await renderCharts();
        expect(basisControl()).not.toBeNull();
        expect(component.selectedActivePlanBasis()).toBe('activeShare');
    });

    it('keeps repeated and invalid display choices silent', async () => {
        fixture.componentRef.setInput('history', history(8));
        await renderCharts();
        component.selectMode('count');
        component.selectMode('invalid' as never);
        component.selectActivePlanBasis('withinPlan');
        component.selectActivePlanBasis('invalid' as never);
        expect(haptics.selection).not.toHaveBeenCalled();
        component.selectMode('percentage');
        component.selectActivePlanBasis('activeShare');
        await renderCharts();
        expect(haptics.selection).toHaveBeenCalledTimes(2);
    });

    it('does not recreate chart hosts when destroyed after queueing a display change', async () => {
        fixture.componentRef.setInput('history', history(8));
        await renderCharts();
        loader.init.mockClear();
        loader.setOption.mockClear();

        component.selectMode('percentage');
        fixture.destroy();
        // Let queued renders and their initialization continuations finish.
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(loader.init).not.toHaveBeenCalled();
        expect(loader.setOption).not.toHaveBeenCalled();
    });

    it('discards delayed chart initialization when the workspace closes', async () => {
        const pendingInitializations: Array<() => void> = [];
        const charts: Array<{ isDisposed: ReturnType<typeof vi.fn>; dispatchAction: ReturnType<typeof vi.fn> }> = [];
        loader.init.mockImplementation(() => new Promise(resolve => {
            const chart = { isDisposed: vi.fn(() => false), dispatchAction: vi.fn() };
            charts.push(chart);
            pendingInitializations.push(() => resolve(chart));
        }));

        fixture.componentRef.setInput('history', history(8));
        component.selectMode('percentage');
        fixture.detectChanges();
        await vi.waitFor(() => expect(loader.init).toHaveBeenCalledTimes(5));
        fixture.destroy();
        pendingInitializations.forEach(resolve => resolve());
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(loader.setOption).not.toHaveBeenCalled();
        expect(loader.init).toHaveBeenCalledTimes(5);
        charts.forEach(chart => expect(loader.dispose).toHaveBeenCalledWith(chart));
    });

    it('disposes every initialized chart host', async () => {
        fixture.componentRef.setInput('history', history(8));
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(5));

        const disposeCallsBeforeDestroy = loader.dispose.mock.calls.length;
        component.ngOnDestroy();

        expect(loader.dispose.mock.calls.length - disposeCallsBeforeDestroy).toBe(5);
    });

    async function renderCharts(expectedCharts = 5): Promise<void> {
        const previous = loader.setOption.mock.calls.length;
        fixture.detectChanges();
        await fixture.whenStable();
        // Chart-host initialization runs outside Angular's stability tracking.
        await vi.waitFor(() => expect(loader.setOption.mock.calls.length).toBeGreaterThanOrEqual(previous + expectedCharts));
    }

    function latestOption(name: string) {
        return loader.setOption.mock.calls.map(call => call[1] as {
            legend: { show: boolean; selected: Record<string, boolean> };
            yAxis: { min: number; max: number; axisLabel: { formatter: (value: number) => string } };
            tooltip: { formatter: (params: unknown) => string };
            series: Array<{ name: string; data: Array<number | null>; connectNulls: boolean }>;
        }).filter(option => option.series.some(series => series.name === name)).at(-1)!;
    }
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
            eligibleByPlan: { free: 4, basic: 3, pro: 2 },
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
