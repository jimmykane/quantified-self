import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HomeComponent } from './home.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAiInsightsHeroPrompts } from '@shared/ai-insights-prompts';
import { TypedPromptRotatorComponent } from '../shared/typed-prompt-rotator/typed-prompt-rotator.component';
import { AppAnalyticsService } from '../../services/app.analytics.service';

describe('HomeComponent', () => {
    let component: HomeComponent;
    let fixture: ComponentFixture<HomeComponent>;
    let mockAuthService: any;
    let mockRouter: any;
    let mockAnalyticsService: any;
    let intersectionObserverCallback: IntersectionObserverCallback | undefined;
    let originalIntersectionObserver: typeof IntersectionObserver | undefined;

    beforeEach(async () => {
        originalIntersectionObserver = globalThis.IntersectionObserver;
        intersectionObserverCallback = undefined;

        class IntersectionObserverMock {
            readonly root: Element | Document | null = null;
            readonly rootMargin = '0px';
            readonly thresholds: ReadonlyArray<number> = [0];

            constructor(callback: IntersectionObserverCallback) {
                intersectionObserverCallback = callback;
            }

            observe = vi.fn();
            unobserve = vi.fn();
            disconnect = vi.fn();
            takeRecords = vi.fn().mockReturnValue([]);
        }

        globalThis.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;

        mockAuthService = {
            getUser: vi.fn().mockResolvedValue(null)
        };

        mockRouter = {
            navigate: vi.fn()
        };

        mockAnalyticsService = {
            logEvent: vi.fn()
        };

        await TestBed.configureTestingModule({
            declarations: [HomeComponent, TypedPromptRotatorComponent],
            imports: [
                MatIconModule,
                MatCardModule,
                MatButtonModule,
                MatDividerModule,
                MatTooltipModule,
                BrowserAnimationsModule
            ],
            providers: [
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: Router, useValue: mockRouter },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService }
            ]
        }).compileComponents();
    });

    afterEach(() => {
        if (originalIntersectionObserver) {
            globalThis.IntersectionObserver = originalIntersectionObserver;
            return;
        }

        delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(HomeComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should keep the original hero messaging and render the AI Insights section', () => {
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('Quantify. Analyze. Improve.');
        expect(text).toContain('Measure Performance. Get AI Insights.');
        expect(text).toContain('AI Insights');
        expect(text).not.toContain('New Feature');
    });

    it('should render the Garmin -> Suunto launch highlight with qualifier and CTAs', () => {
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('Garmin -> Suunto sync is now live');
        expect(text).toContain('Requires Pro and active Garmin + Suunto connections.');
        expect(text).toContain('Set up sync');
        expect(text).toContain('How it works');
        expect(fixture.nativeElement.querySelector('.garmin-suunto-launch')).toBeTruthy();
    });

    it('should render the shared typed prompt rotator in the examples area', () => {
        const sharedHeroPrompts = getAiInsightsHeroPrompts();
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('What you can ask');
        expect(text).not.toContain('Auto-rotating:');
        expect(fixture.nativeElement.querySelector('app-typed-prompt-rotator')).toBeTruthy();
        expect(fixture.nativeElement.querySelector('.hero-prompt-caret')).toBeTruthy();
        expect(component.aiPromptExamples).toEqual(sharedHeroPrompts);
        const promptText = fixture.nativeElement.querySelector('.hero-prompt-text') as HTMLElement | null;
        expect(promptText?.textContent?.trim()).toBe((sharedHeroPrompts[0] ?? '').slice(0, 1));
    });

    it('should log the Garmin -> Suunto highlight impression once when the launch card enters view', () => {
        const launchCard = fixture.nativeElement.querySelector('.garmin-suunto-launch') as Element;
        expect(launchCard).toBeTruthy();
        expect(intersectionObserverCallback).toBeTruthy();

        intersectionObserverCallback?.(
            [{ target: launchCard, isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver
        );
        intersectionObserverCallback?.(
            [{ target: launchCard, isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver
        );

        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('home_garmin_suunto_highlight_view', {
            placement: 'integrations_mid_page'
        });

        const launchViewCalls = mockAnalyticsService.logEvent.mock.calls.filter(
            (args: [string, Record<string, string> | undefined]) => args[0] === 'home_garmin_suunto_highlight_view'
        );
        expect(launchViewCalls).toHaveLength(1);
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

    describe('Garmin -> Suunto launch actions', () => {
        it('should route signed-in users to services and log CTA click metadata', async () => {
            mockAuthService.getUser.mockResolvedValue({ uid: '123' });
            await component.navigateToServiceSetupOrLogin();

            expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('home_garmin_suunto_cta_click', {
                cta: 'set_up_sync',
                destination: 'services'
            });
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/services']);
        });

        it('should route signed-out users to login with returnUrl and log CTA click metadata', async () => {
            mockAuthService.getUser.mockResolvedValue(null);
            await component.navigateToServiceSetupOrLogin();

            expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('home_garmin_suunto_cta_click', {
                cta: 'set_up_sync',
                destination: 'login_return_services'
            });
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/login'], {
                queryParams: { returnUrl: '/services' }
            });
        });

        it('should navigate to service connection help and log CTA click metadata', async () => {
            await component.navigateToServiceConnectionsHelp();

            expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('home_garmin_suunto_cta_click', {
                cta: 'how_it_works',
                destination: 'help_service_connections'
            });
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/help'], {
                fragment: 'service-connections'
            });
        });
    });
});
