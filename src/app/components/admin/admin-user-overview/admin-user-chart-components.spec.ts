import { TestBed } from '@angular/core/testing';
import { AppThemes } from '@sports-alliance/sports-lib';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemeService } from '../../../services/app.theme.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import { AdminAuthProviderChartComponent } from './admin-auth-provider-chart.component';
import { AdminUserGrowthChartComponent } from './admin-user-growth-chart.component';

describe('admin user chart components', () => {
    let theme: BehaviorSubject<AppThemes>;
    let loader: {
        init: ReturnType<typeof vi.fn>;
        setOption: ReturnType<typeof vi.fn>;
        resize: ReturnType<typeof vi.fn>;
        dispose: ReturnType<typeof vi.fn>;
        subscribeToViewportResize: ReturnType<typeof vi.fn>;
        attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        theme = new BehaviorSubject(AppThemes.Normal);
        const chart = { isDisposed: vi.fn(() => false), dispatchAction: vi.fn() };
        loader = {
            init: vi.fn(() => Promise.resolve(chart)),
            setOption: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn(),
            subscribeToViewportResize: vi.fn(() => () => undefined),
            attachMobileSeriesTapFeedback: vi.fn(() => () => undefined),
        };
        await TestBed.configureTestingModule({
            imports: [AdminAuthProviderChartComponent, AdminUserGrowthChartComponent],
            providers: [
                { provide: AppThemeService, useValue: { getAppTheme: () => theme } },
                { provide: EChartsLoaderService, useValue: loader },
                { provide: LoggerService, useValue: { error: vi.fn() } },
            ],
        }).compileComponents();
    });

    it('renders provider inputs and disposes its chart host', async () => {
        const fixture = TestBed.createComponent(AdminAuthProviderChartComponent);
        fixture.componentRef.setInput('providers', { password: 4 });
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalled());

        const option = loader.setOption.mock.calls.at(-1)?.[1] as { series?: Array<{ data?: unknown[] }> };
        expect(option.series?.[0].data).toHaveLength(1);
        fixture.destroy();
        expect(loader.dispose).toHaveBeenCalled();
    });

    it('fully resets the provider chart when refreshed with empty data', async () => {
        const fixture = TestBed.createComponent(AdminAuthProviderChartComponent);
        fixture.componentRef.setInput('providers', { password: 4 });
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalled());
        const populatedRenderCount = loader.setOption.mock.calls.length;

        fixture.componentRef.setInput('providers', {});
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption.mock.calls.length).toBeGreaterThan(populatedRenderCount));

        const [, option, settings] = loader.setOption.mock.calls.at(-1) as [
            unknown,
            { graphic?: unknown[]; series?: unknown[] },
            { notMerge?: boolean },
        ];
        expect(option.graphic).toEqual([]);
        expect(option.series).toEqual([]);
        expect(settings).toEqual({ notMerge: true });
        fixture.destroy();
    });

    it('rerenders growth data when the theme changes', async () => {
        const fixture = TestBed.createComponent(AdminUserGrowthChartComponent);
        fixture.componentRef.setInput('stats', { total: 10, onboardingCompleted: 7, basic: 2, pro: 1 });
        fixture.componentRef.setInput('userGrowthTrend', {
            months: 12,
            buckets: [{ key: '2026-08', label: 'Aug', registeredUsers: 2, onboardedUsers: 1 }],
            totals: { registeredUsers: 2, onboardedUsers: 1 },
        });
        fixture.detectChanges();
        await fixture.whenStable();
        await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalled());
        const rendersBeforeThemeChange = loader.setOption.mock.calls.length;

        theme.next(AppThemes.Dark);
        await vi.waitFor(() => expect(loader.setOption.mock.calls.length).toBeGreaterThan(rendersBeforeThemeChange));
        expect(loader.dispose).toHaveBeenCalled();
        fixture.destroy();
    });
});
