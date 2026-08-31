import {
    ComponentFixture,
    DeferBlockBehavior,
    DeferBlockState,
    TestBed,
} from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HomeComponent } from './home.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltip, MatTooltipModule } from '@angular/material/tooltip';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { ASSISTANT_STARTER_PROMPTS } from '@shared/assistant.prompts';
import { AppThemes } from '@sports-alliance/sports-lib';
import { signal } from '@angular/core';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';

describe('HomeComponent', () => {
    let component: HomeComponent;
    let fixture: ComponentFixture<HomeComponent>;
    let mockAuthService: any;
    let mockRouter: any;
    let userSubject: BehaviorSubject<any>;
    const chart = {
        dispatchAction: vi.fn(),
        isDisposed: vi.fn(() => false),
        on: vi.fn(),
        off: vi.fn(),
    };
    const eChartsLoader = {
        init: vi.fn().mockResolvedValue(chart),
        setOption: vi.fn(),
        dispose: vi.fn(),
        resize: vi.fn(),
        subscribeToViewportResize: vi.fn(() => vi.fn()),
        attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()),
    };

    beforeEach(async () => {
        userSubject = new BehaviorSubject<any>(null);
        vi.clearAllMocks();
        mockAuthService = {
            getUser: vi.fn().mockResolvedValue(null),
            user$: userSubject.asObservable()
        };

        await TestBed.configureTestingModule({
            deferBlockBehavior: DeferBlockBehavior.Manual,
            imports: [
                HomeComponent,
                RouterTestingModule.withRoutes([]),
                MatIconModule,
                MatIconTestingModule,
                MatCardModule,
                MatButtonModule,
                MatTooltipModule,
                BrowserAnimationsModule
            ],
            providers: [
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
                { provide: EChartsLoaderService, useValue: eChartsLoader },
                { provide: LoggerService, useValue: { error: vi.fn() } },
            ]
        }).compileComponents();

        mockRouter = TestBed.inject(Router);
        vi.spyOn(mockRouter, 'navigate').mockResolvedValue(true);
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(HomeComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should redirect app-authenticated browser users from public home to dashboard', () => {
        userSubject.next({ uid: '123' });

        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should keep anonymous browser users on the public home page', () => {
        userSubject.next(null);

        expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should keep passive homepage tooltips from claiming touch gestures', () => {
        const tooltipHosts = fixture.debugElement.queryAll(By.directive(MatTooltip));

        expect(tooltipHosts.length).toBeGreaterThan(0);
        expect(tooltipHosts.every(host => host.injector.get(MatTooltip).touchGestures === 'off')).toBe(true);
    });

    it('should render provider-focused hero messaging and a standalone Assistant section', () => {
        const text = fixture.nativeElement.textContent as string;
        const heroText = (fixture.nativeElement.querySelector('.hero-section') as HTMLElement | null)?.textContent ?? '';
        const aiSectionText = (fixture.nativeElement.querySelector('.ai-insights-section') as HTMLElement | null)?.textContent ?? '';
        expect(heroText).toContain('Your Training Data, Connected.');
        expect(heroText).toContain('One Dashboard. Every Activity in Context.');
        expect(heroText).toContain('Bring Garmin, Suunto, COROS, and Wahoo activities together.');
        expect(heroText).toContain('Understand readiness, training load, sleep, routes,');
        expect(heroText).toContain('keep supported activities synced across services');
        expect(heroText).toContain('Your Data Stays Yours');
        expect(heroText).not.toContain('Export Anytime');
        expect(heroText).not.toMatch(/\bprivate\b/i);
        expect(heroText).not.toContain('Quantified Self Assistant');
        expect(heroText).not.toContain('chart-backed answers');
        expect(aiSectionText).toContain('Ask About Your Training');
        expect(aiSectionText).toContain('Explore sleep, readiness, training, measurements, and recent activities in one conversation.');
        expect(aiSectionText).toContain('The Assistant answers from your current data');
        expect(aiSectionText).toContain('not generic fitness advice');
        expect(aiSectionText).toContain('Ask in Your Own Words');
        expect(aiSectionText).toContain('Ask follow-up questions without starting over.');
        expect(aiSectionText).toContain('Bring Your Data Together');
        expect(aiSectionText).toContain('when your question needs the broader context.');
        expect(aiSectionText).toContain('Check the Evidence');
        expect(aiSectionText).toContain('see exactly what supports it.');
        expect(aiSectionText).toContain('Connect Other AI Tools');
        expect(aiSectionText).toContain('Grant access to the training, sleep, measurements, activity charts, and routes you choose.');
        expect(aiSectionText).toContain('Location access remains a separate permission.');
        expect(aiSectionText).toContain('Explore MCP Access');
        expect(aiSectionText).not.toContain('read-only sleep, readiness');
        expect(aiSectionText).not.toContain('complete training history');
        expect(aiSectionText).not.toContain('Read-only MCP Server');
        expect(aiSectionText).toContain('Explore the Assistant');
        expect(fixture.nativeElement.querySelectorAll('.ai-insights-section .features-grid .feature-icon-container[data-nosnippet]').length).toBe(3);
        expect(fixture.nativeElement.querySelector('a[routerlink="/features/ai-insights"], a[ng-reflect-router-link="/features/ai-insights"]')).toBeTruthy();
        expect(fixture.nativeElement.querySelector('.ai-insights-section a[routerlink="/features/mcp-server"], .ai-insights-section a[ng-reflect-router-link="/features/mcp-server"]')).toBeTruthy();
        expect(text).not.toContain('New Feature');
    });

    it('should render home sections in the requested narrative order', () => {
        const sectionOrder = Array.from(
            fixture.nativeElement.querySelectorAll('.landing-page > section, .landing-page > footer')
        ).map((section: Element) => {
            if (section.classList.contains('hero-section')) {
                return 'hero';
            }
            if (section.classList.contains('integrations-section')) {
                return 'integrations';
            }
            if (section.classList.contains('features-section') && !section.classList.contains('ai-insights-section')) {
                return 'performance';
            }
            if (section.classList.contains('ai-insights-section')) {
                return 'ai-insights';
            }
            if (section.classList.contains('footprint-section')) {
                return 'footprint';
            }
            if (section.classList.contains('sovereignty-section')) {
                return 'sovereignty';
            }
            if (section.classList.contains('analysis-section')) {
                return 'hardware';
            }
            return 'unknown';
        });

        expect(sectionOrder).toEqual([
            'hero',
            'integrations',
            'performance',
            'ai-insights',
            'footprint',
            'sovereignty',
            'hardware',
        ]);
    });

    it('should render three precise integration principles with one integrations hub link', () => {
        const text = fixture.nativeElement.textContent as string;
        const integrationRows = fixture.nativeElement.querySelectorAll(
            '.integration-followup-list .integration-capability'
        );
        const integrationLinks = fixture.nativeElement.querySelectorAll(
            'a[href="/integrations"], a[routerlink="/integrations"], a[ng-reflect-router-link="/integrations"]'
        );

        expect(integrationRows.length).toBe(3);
        expect(fixture.nativeElement.querySelector('.integration-followup-list mat-card')).toBeNull();
        expect(text).toContain('Bring It In. Keep It Moving.');
        expect(text).toContain('Sync Your History');
        expect(text).toContain('New activities arrive automatically');
        expect(text).toContain('activity history already stored with each provider');
        expect(text).not.toContain('FIT-backed Wahoo history');
        expect(text).not.toContain('rolling 5 years');
        expect(text).not.toContain('last 3 months');
        expect(text).toContain('Move Workouts and Routes');
        expect(text).toContain('automatic delivery between supported providers');
        expect(text).toContain('send past activities by date range');
        expect(text).toContain('Garmin → Suunto, Wahoo, or COROS');
        expect(text).toContain('Import Suunto routes');
        expect(text).toContain('Send saved FIT/GPX routes manually');
        expect(text).toContain('Upload Your Own Files');
        expect(text).toContain('FIT, TCX, GPX, JSON, and SML activity files');
        expect(text).toContain('send FIT activities directly to Suunto, COROS, or Wahoo');
        expect(fixture.nativeElement.querySelector('mat-icon[svgIcon="wahoo"], mat-icon[ng-reflect-svg-icon="wahoo"]')).toBeTruthy();
        expect(text).toContain('Explore Integrations');
        expect(text).not.toContain('Explore Wahoo');
        expect(integrationLinks.length).toBe(1);
        expect(text).not.toContain('Set up sync');
        expect(text).not.toContain('How it works');
        expect(fixture.nativeElement.querySelector('.garmin-suunto-launch')).toBeNull();
    });

    it('should surface a concrete Training snapshot and supporting analysis capabilities', () => {
        const text = fixture.nativeElement.textContent as string;
        const performanceCards = fixture.nativeElement.querySelectorAll(
            '.features-section:not(.ai-insights-section) .features-grid .feature-card'
        );
        const trainingPreview = fixture.nativeElement.querySelector('.training-preview-card');
        const trainingPreviewIndicators = fixture.nativeElement.querySelectorAll(
            '.training-preview-card app-metric-indicator'
        );
        const signalPreviews = fixture.nativeElement.querySelectorAll('.signal-preview-widget');
        const deferredPreviewPlaceholders = fixture.nativeElement.querySelectorAll('.home-preview-placeholder');

        expect(performanceCards.length).toBe(3);
        expect(trainingPreview).toBeTruthy();
        expect(trainingPreview.querySelector('.training-preview-content[data-nosnippet]')).toBeTruthy();
        expect(trainingPreview.querySelector('app-training-summary-cards')).toBeTruthy();
        expect(trainingPreview.querySelectorAll('app-training-metric-grid')).toHaveLength(2);
        expect(trainingPreviewIndicators.length).toBe(3);
        expect(signalPreviews.length).toBe(0);
        expect(deferredPreviewPlaceholders.length).toBe(3);
        expect(fixture.nativeElement.querySelector('.home-preview-placeholder--signals[data-nosnippet]')).toBeTruthy();
        expect(text).toContain('Bring It In. Keep It Moving.');
        expect(text).toContain('Training Load, Readiness, and Recovery');
        expect(text).toContain('See your current load, fitness, fatigue, form, recovery, intensity balance, and efficiency');
        expect(text).not.toContain('Illustrative data');
        expect(text).toContain('Your Training Snapshot');
        expect(text).toContain('Balanced');
        expect(text).toContain('TSS-only load model');
        expect(text).toContain('Readiness today');
        expect(text).toContain('Load + recorded sleep signals');
        expect(text).toContain('Training time');
        expect(text).toContain('18h 42m');
        expect(text).toContain('Workouts');
        expect(text).toContain('ACWR');
        expect(text).toContain('Monotony');
        expect(text).toContain('Strain');
        expect(text).toContain('Form now');
        expect(text).toContain('Form +7 days');
        expect(text).toContain('Fitness (CTL)');
        expect(text).toContain('Fatigue (ATL)');
        expect(text).toContain('Recovery debt');
        expect(text).toContain('Recovery left');
        expect(text).toContain('Intensity balance');
        expect(text).toContain('Efficiency');
        expect(text).toContain('Explore Training');
        expect(fixture.nativeElement.querySelector('a[routerlink="/features/training-analysis"], a[ng-reflect-router-link="/features/training-analysis"]')).toBeTruthy();
        expect(text).toContain('Freshness Forecast');
        expect(text).toContain('Intensity Distribution');
        expect(text).toContain('Efficiency Trend');
        expect(text).toContain('Cycling Power Curve');
        expect(text).toContain('sleep views');
        expect(text).not.toContain('Training Load & Readiness Engine');
        expect(text).not.toContain('Derived metrics turn your activity history into load, fatigue, form, recovery, ramp, and intensity signals');
        expect(text).not.toContain('Form Model (CTL / ATL / TSB)');
        expect(text).toContain('Charts Behind Every Signal');
        expect(text).toContain('Build the Dashboard You Need');
        expect(text).toContain('Start from a preset or arrange');
        expect(text).toContain('Curated');
        expect(text).toContain('KPI');
        expect(text).toContain('Custom');
        expect(text).toContain('Map');
        expect(text).toContain('marker-clustering controls');
        expect(text).toContain('Analyze Every Workout');
        expect(text).toContain('Compare heart rate, power, altitude, depth, pace, and more in synchronized charts');
        expect(text).toContain('View zones');
        expect(text).toContain('grade-colored elevation');
        expect(text).toContain('inverse depth');
        expect(text).toContain('distance, duration, or time where supported');
        expect(text).toContain('select a range for stats or zoom in');
        expect(text).not.toContain('7 chart types');
        expect(text).not.toContain('12 map styles');
        expect(text).not.toContain('recorded streams');
        expect(text).not.toContain('routes with heatmaps');
        expect(text).toContain('Open Your Dashboard');
        expect(text).not.toContain('Explore Activity Calendar');
        expect(fixture.nativeElement.querySelector('a[routerlink="/dashboard"], a[ng-reflect-router-link="/dashboard"]')).toBeTruthy();
        expect(text).not.toContain('Read-only MCP Server');
        expect(text).not.toContain('KPI Lane for Fast Decisions');
        expect(text).not.toContain('Connected Training Data');
    });

    it('should render the shared signal charts when the deferred section completes', async () => {
        const deferBlocks = await fixture.getDeferBlocks();

        expect(deferBlocks.length).toBe(3);
        await deferBlocks[0].render(DeferBlockState.Complete);
        await fixture.whenStable();

        expect(fixture.nativeElement.querySelectorAll('.signal-preview-widget').length).toBe(4);
        expect(fixture.nativeElement.querySelector('.signal-preview-form-widget')).toBeTruthy();
        expect(fixture.nativeElement.querySelector('.home-preview-placeholder--signals')).toBeNull();
        expect(eChartsLoader.setOption).toHaveBeenCalledTimes(5);
    });

    it('should explain benchmark merge and hardware precision workflows', () => {
        const text = fixture.nativeElement.textContent as string;
        const analysisCards = fixture.nativeElement.querySelectorAll('.analysis-section .analysis-card');

        expect(analysisCards.length).toBe(3);
        expect(text).toContain('Map Your Activities');
        expect(text).toContain('Own Your Data');
        expect(text).toContain('Compare Your Devices');
        expect(text).toContain('Merge same-session recordings, choose a reference device');
        expect(text).toContain('Benchmark Merge Workflow');
        expect(text).toContain('keep it out of normal training totals');
        expect(text).toContain('Ref / Test');
        expect(text).toContain('+/-15s');
        expect(text).toContain('GNSS Trace Comparison');
        expect(text).toContain('CEP50, CEP95, RMSE, max deviation, and');
        expect(text).toContain('Sensor Quality Reports');
        expect(text).toContain('correlation, MAE, and RMSE');
        expect(text).toContain('dropouts, stuck values, and cadence-lock');
        expect(text).toContain('Save / Share');
        expect(text).toContain('Compare Workout Data');
        expect(text).toContain('Device Benchmarks');
        expect(fixture.nativeElement.querySelector('a[routerlink="/features/workout-data-comparison"], a[ng-reflect-router-link="/features/workout-data-comparison"]')).toBeTruthy();
        expect(fixture.nativeElement.querySelector('a[routerlink="/features/sports-watch-benchmark"], a[ng-reflect-router-link="/features/sports-watch-benchmark"]')).toBeTruthy();
        expect(text).not.toContain('Benchmark your devices with high-fidelity trace comparison.');
        expect(text).not.toContain('Sync Quality');
    });

    it('should render the shared typed prompt rotator in the examples area', () => {
        const sharedHeroPrompts = ASSISTANT_STARTER_PROMPTS;
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('What you can ask');
        expect(text).not.toContain('Auto-rotating:');
        expect(fixture.nativeElement.querySelector('app-typed-prompt-rotator')).toBeTruthy();
        expect(fixture.nativeElement.querySelector('.hero-prompt-caret')).toBeTruthy();
        expect(component.assistantPromptExamples).toEqual(sharedHeroPrompts);
        const promptText = fixture.nativeElement.querySelector('.hero-prompt-text') as HTMLElement | null;
        expect(promptText?.textContent?.trim()).toBe((sharedHeroPrompts[0] ?? '').slice(0, 1));
    });

    it('should keep animated content visible when IntersectionObserver is unavailable', () => {
        const originalIntersectionObserver = globalThis.IntersectionObserver;
        Object.defineProperty(globalThis, 'IntersectionObserver', {
            value: undefined,
            configurable: true,
        });

        try {
            component.ngAfterViewInit();
            const animatedElements = Array.from(
                fixture.nativeElement.querySelectorAll('.animate-on-scroll')
            ) as Element[];

            expect(animatedElements.length).toBeGreaterThan(0);
            expect(animatedElements.every(element => element.classList.contains('is-visible'))).toBe(true);
        } finally {
            Object.defineProperty(globalThis, 'IntersectionObserver', {
                value: originalIntersectionObserver,
                configurable: true,
            });
        }
    });

    it('should reveal scroll content once without hiding it after viewport changes', () => {
        fixture.destroy();
        const originalIntersectionObserver = globalThis.IntersectionObserver;
        const observerRecords: Array<{
            callback: IntersectionObserverCallback;
            observe: ReturnType<typeof vi.fn>;
            unobserve: ReturnType<typeof vi.fn>;
            disconnect: ReturnType<typeof vi.fn>;
        }> = [];

        Object.defineProperty(globalThis, 'IntersectionObserver', {
            configurable: true,
            value: vi.fn((callback: IntersectionObserverCallback) => {
                const record = {
                    callback,
                    observe: vi.fn(),
                    unobserve: vi.fn(),
                    disconnect: vi.fn(),
                };
                observerRecords.push(record);
                return {
                    ...record,
                    takeRecords: vi.fn(() => []),
                    root: null,
                    rootMargin: '',
                    thresholds: [0.1],
                } as IntersectionObserver;
            }),
        });

        try {
            fixture = TestBed.createComponent(HomeComponent);
            component = fixture.componentInstance;
            fixture.detectChanges();

            const target = fixture.nativeElement.querySelector('.animate-on-scroll') as Element;
            const homeObserver = observerRecords.find(record =>
                record.observe.mock.calls.some(([observedTarget]) => observedTarget === target)
            );
            expect(homeObserver).toBeTruthy();
            expect(target.classList.contains('is-visible')).toBe(false);

            homeObserver?.callback([
                { isIntersecting: true, target } as IntersectionObserverEntry,
            ], {} as IntersectionObserver);
            expect(target.classList.contains('is-visible')).toBe(true);
            expect(homeObserver?.unobserve).toHaveBeenCalledWith(target);

            homeObserver?.callback([
                { isIntersecting: false, target } as IntersectionObserverEntry,
            ], {} as IntersectionObserver);
            expect(target.classList.contains('is-visible')).toBe(true);
        } finally {
            fixture.destroy();
            Object.defineProperty(globalThis, 'IntersectionObserver', {
                configurable: true,
                value: originalIntersectionObserver,
            });
        }
    });

    describe('navigateToDashboardOrLogin', () => {
        it('should navigate to dashboard if user is logged in', async () => {
            mockAuthService.getUser.mockResolvedValue({ uid: '123' });
            await component.navigateToDashboardOrLogin();
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        });

        it('should navigate to login if user is not logged in', async () => {
            mockAuthService.getUser.mockResolvedValue(null);
            await component.navigateToDashboardOrLogin();
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
        });
    });
});
