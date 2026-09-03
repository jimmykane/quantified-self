import {
    ComponentFixture,
    DeferBlockBehavior,
    TestBed,
} from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HomeComponent } from './home.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltip, MatTooltipModule } from '@angular/material/tooltip';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { AppThemes } from '@sports-alliance/sports-lib';
import { signal } from '@angular/core';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { CompactFeatureRowComponent } from '../shared/compact-feature-row/compact-feature-row.component';
import { ProviderDataFlowMatrixComponent } from '../shared/provider-data-flow-matrix/provider-data-flow-matrix.component';
import { PublicFeaturePreviewComponent } from '../public-seo/public-feature-preview.component';

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

    it('keeps every homepage CTA on an auth entry or public product page', () => {
        const ctaLinks = Array.from(fixture.nativeElement.querySelectorAll('.landing-page a[href]')) as HTMLAnchorElement[];
        const paths = ctaLinks.map(link => new URL(link.href).pathname);
        const privateWorkspacePaths = ['/dashboard', '/mytracks', '/training', '/calendar', '/health', '/routes', '/services', '/settings'];

        expect(paths.filter(path => path === '/login')).toHaveLength(2);
        expect(paths.some(path => privateWorkspacePaths.includes(path))).toBe(false);
        expect(paths.every(path => path === '/login' || path === '/integrations' || path.startsWith('/features/'))).toBe(true);
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
        expect(aiSectionText).toContain('Analyze with ChatGPT or Claude');
        expect(aiSectionText).toContain('analyze your training, review your season, plan your next workout, or draft a longer training-plan proposal');
        expect(aiSectionText).toContain('load, fatigue, readiness, sleep, measurements, workout charts, and routes');
        expect(aiSectionText).toContain('neither tool can add workouts or change your account');
        expect(aiSectionText).toContain('Location access remains separate.');
        expect(aiSectionText).toContain('Connect ChatGPT or Claude');
        expect(aiSectionText).not.toContain('read-only sleep, readiness');
        expect(aiSectionText).not.toContain('complete training history');
        expect(aiSectionText).not.toContain('Read-only MCP Server');
        expect(aiSectionText).toContain('Explore the Assistant');
        expect(fixture.nativeElement.querySelectorAll('.ai-insights-section .features-grid app-compact-feature-row').length).toBe(3);
        expect(fixture.nativeElement.querySelector('.mcp-access-row').classList)
            .toContain('compact-feature-row-host--without-divider');
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
            'hardware',
            'sovereignty',
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
        expect(text).toContain('Supported provider paths');
        expect(text).toContain('Activity paths:');
        expect(text).toContain('backfill past activities by date range');
        expect(text).toContain('Route paths:');
        expect(text).toContain('Deliver imported Suunto routes automatically or on demand');
        expect(text).toContain('Saved FIT/GPX routes');
        const providerMatrix = fixture.debugElement.query(By.directive(ProviderDataFlowMatrixComponent));
        expect(providerMatrix).toBeTruthy();
        expect(providerMatrix.componentInstance.rows()).toBe(component.providerDataFlowRows);
        expect(providerMatrix.componentInstance.compact()).toBe(true);
        expect(providerMatrix.componentInstance.interactive()).toBe(false);
        expect(providerMatrix.nativeElement.hasAttribute('data-nosnippet')).toBe(true);
        expect(providerMatrix.nativeElement.querySelector('.provider-data-flow-matrix__mobile')).toBeNull();
        expect(providerMatrix.nativeElement.querySelectorAll('button')).toHaveLength(0);
        expect(text).toContain('Upload Your Own Files');
        expect(text).toContain('FIT, TCX, GPX, JSON, and SML activity files');
        expect(text).toContain('send FIT activities directly to Suunto, COROS, or Wahoo');
        const integrationDividerRows = fixture.debugElement.queryAll(By.directive(CompactFeatureRowComponent))
            .filter(row => row.nativeElement.classList.contains('integration-capability'));
        expect(integrationDividerRows).toHaveLength(3);
        expect(integrationDividerRows[0].componentInstance.showDivider()).toBe(true);
        expect(integrationDividerRows[1].componentInstance.showDivider()).toBe(true);
        expect(integrationDividerRows[2].componentInstance.showDivider()).toBe(false);
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
        const trainingPreview = fixture.nativeElement.querySelector('.training-preview-row');
        const signalPreviews = fixture.nativeElement.querySelectorAll('.signal-preview-widget');
        const publicPreviews = fixture.debugElement.queryAll(By.directive(PublicFeaturePreviewComponent));
        const previewKeys = publicPreviews.map(preview => preview.componentInstance.previewKey());

        expect(performanceCards.length).toBe(3);
        expect(trainingPreview).toBeTruthy();
        expect(trainingPreview.classList).toContain('compact-feature-row-host--without-divider');
        expect(performanceCards[0].classList).not.toContain('compact-feature-row-host--without-divider');
        expect(trainingPreview.querySelector('.training-preview-data[data-nosnippet]')).toBeTruthy();
        expect(signalPreviews.length).toBe(0);
        expect(previewKeys).toContain('training-snapshot');
        expect(previewKeys).toContain('training-signals');
        expect(previewKeys).toContain('dashboard');
        expect(previewKeys).toContain('workout-analysis');
        expect(text).toContain('Bring It In. Keep It Moving.');
        expect(text).toContain('Training Load, Readiness, and Recovery');
        expect(text).toContain('See your current load, fitness, fatigue, form, recovery, intensity balance, and efficiency');
        expect(text).not.toContain('Illustrative data');
        expect(text).toContain('Your Training Snapshot');
        expect(text).toContain('Explore Training Analysis');
        const trainingCta = fixture.nativeElement.querySelector(
            '.training-actions a[routerlink="/features/training-analysis"], .training-actions a[ng-reflect-router-link="/features/training-analysis"]'
        ) as HTMLAnchorElement | null;
        expect(trainingCta).toBeTruthy();
        expect(trainingPreview.querySelector('[compactFeatureRowAction]')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('.features-grid')?.compareDocumentPosition(trainingCta!) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
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
        expect(text).toContain('Inspect intensity zones');
        expect(text).toContain('grade-colored elevation');
        expect(text).toContain('inverse depth');
        expect(text).toContain('distance, duration, or time where supported');
        expect(text).toContain('select a range for stats or zoom in');
        expect(text).toContain('aerobic durability, and cadence versus power');
        expect(text).not.toContain('7 chart types');
        expect(text).not.toContain('12 map styles');
        expect(text).not.toContain('recorded streams');
        expect(text).not.toContain('routes with heatmaps');
        expect(text).not.toContain('Open Your Dashboard');
        expect(text).not.toContain('Explore Activity Calendar');
        expect(fixture.nativeElement.querySelector('a[routerlink="/dashboard"], a[ng-reflect-router-link="/dashboard"]')).toBeNull();
        expect(text).not.toContain('Read-only MCP Server');
        expect(text).not.toContain('KPI Lane for Fast Decisions');
        expect(text).not.toContain('Connected Training Data');
    });

    it('uses the shared compact row primitive for every top-level homepage card', () => {
        const compactRows = fixture.nativeElement.querySelectorAll('app-compact-feature-row');

        expect(compactRows.length).toBe(11);
        expect(fixture.nativeElement.querySelector('mat-card')).toBeNull();
        expect(fixture.nativeElement.querySelectorAll('.compact-row-stack').length).toBe(5);
        expect(Array.from(compactRows).every((row: Element) => row.querySelector('article.compact-feature-row'))).toBe(true);
        expect(fixture.nativeElement.querySelector('app-public-feature-preview[previewkey="reviewer-benchmark"]')).toBeTruthy();
    });

    it('should delegate every visual to the shared deferred preview boundary', () => {
        const previews = fixture.debugElement.queryAll(By.directive(PublicFeaturePreviewComponent));
        const previewKeys = previews.map(preview => preview.componentInstance.previewKey());

        expect(previewKeys).toEqual([
            'training-snapshot',
            'training-signals',
            'dashboard',
            'workout-analysis',
            'assistant-example',
            'mcp-flow',
            'activity-map',
            'reviewer-benchmark',
        ]);
        expect(previews.every(preview => preview.nativeElement.hasAttribute('data-nosnippet'))).toBe(true);
    });

    it('should explain benchmark merge and hardware precision workflows', () => {
        const text = fixture.nativeElement.textContent as string;
        const publicPreviews = fixture.debugElement.queryAll(By.directive(PublicFeaturePreviewComponent));
        const previewKeys = publicPreviews.map(preview => preview.componentInstance.previewKey());

        expect(previewKeys).toContain('reviewer-benchmark');
        expect(text).toContain('Map Your Activities');
        expect(text).toContain('See every GPS activity together');
        expect(text).toContain('filter by date or activity type');
        expect(text).toContain('Real activity traces');
        expect(previewKeys).toContain('activity-map');
        expect(fixture.nativeElement.querySelector('app-home-my-tracks-preview')).toBeNull();
        const mapStage = fixture.nativeElement.querySelector('.footprint-map-stage') as HTMLElement;
        const mapCta = fixture.nativeElement.querySelector('.footprint-cta') as HTMLElement;
        expect(mapStage.compareDocumentPosition(mapCta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(text).toContain('Your Data. Yours to Keep.');
        expect(text).toContain('Download your original activity files whenever you want');
        expect(text).toContain('creating a backup, changing services');
        expect(text).not.toContain('No hidden mining');
        expect(text).toContain('Built for Device Reviewers');
        expect(text).toContain('Compare same-session recordings from watches, bike computers, and sensors');
        expect(text).toContain('turn GNSS and sensor differences into repeatable evidence');
        expect(fixture.nativeElement.querySelector('.analysis-header-icon')?.textContent?.trim()).toBe('rate_review');
        expect(text).toContain('Compare Workouts and Devices');
        expect(fixture.nativeElement.querySelector('a[routerlink="/features/workout-data-comparison"], a[ng-reflect-router-link="/features/workout-data-comparison"]')).toBeTruthy();
        expect(text).not.toContain('Benchmark your devices with high-fidelity trace comparison.');
        expect(text).not.toContain('Sync Quality');
    });

    it('should delegate Assistant examples to the shared deferred preview', () => {
        const assistantPreview = fixture.debugElement.queryAll(By.directive(PublicFeaturePreviewComponent))
            .find(preview => preview.componentInstance.previewKey() === 'assistant-example');

        expect(assistantPreview).toBeTruthy();
        expect(assistantPreview?.nativeElement.hasAttribute('data-nosnippet')).toBe(true);
        expect(fixture.nativeElement.querySelector('app-typed-prompt-rotator')).toBeNull();
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

});
