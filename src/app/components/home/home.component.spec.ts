import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HomeComponent } from './home.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { getAiInsightsHeroPrompts } from '@shared/ai-insights-prompts';
import { TypedPromptRotatorComponent } from '../shared/typed-prompt-rotator/typed-prompt-rotator.component';

describe('HomeComponent', () => {
    let component: HomeComponent;
    let fixture: ComponentFixture<HomeComponent>;
    let mockAuthService: any;
    let mockRouter: any;
    let userSubject: BehaviorSubject<any>;

    beforeEach(async () => {
        userSubject = new BehaviorSubject<any>(null);
        mockAuthService = {
            getUser: vi.fn().mockResolvedValue(null),
            user$: userSubject.asObservable()
        };

        mockRouter = {
            navigate: vi.fn()
        };

        await TestBed.configureTestingModule({
            declarations: [HomeComponent, TypedPromptRotatorComponent],
            imports: [
                MatIconModule,
                MatIconTestingModule,
                MatCardModule,
                MatButtonModule,
                MatDividerModule,
                MatTooltipModule,
                BrowserAnimationsModule
            ],
            providers: [
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: Router, useValue: mockRouter }
            ]
        }).compileComponents();
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

    it('should render provider-focused hero messaging and a standalone AI Insights section', () => {
        const text = fixture.nativeElement.textContent as string;
        const heroText = (fixture.nativeElement.querySelector('.hero-section') as HTMLElement | null)?.textContent ?? '';
        const aiSectionText = (fixture.nativeElement.querySelector('.ai-insights-section') as HTMLElement | null)?.textContent ?? '';
        const footerIcons = Array.from(
            fixture.nativeElement.querySelectorAll('.tech-stack mat-icon')
        ) as HTMLElement[];
        const firebaseIcon = fixture.nativeElement.querySelector('.tech-stack mat-icon[svgIcon="firebase"]');
        const contactLink = fixture.nativeElement.querySelector('.legal-links a[href="mailto:support@quantified-self.io"]') as HTMLElement | null;
        expect(heroText).toContain('Quantify. Analyze. Improve.');
        expect(heroText).toContain('One Dashboard. Every Activity.');
        expect(heroText).toContain('Bring Garmin, Suunto, and COROS activity data into one private training dashboard.');
        expect(heroText).toContain('keep Garmin or COROS activities syncing to Suunto');
        expect(heroText).not.toContain('AI Insights');
        expect(heroText).not.toContain('chart-backed answers');
        expect(aiSectionText).toContain('AI Insights');
        expect(aiSectionText).toContain('Turn focused training questions into chart-backed answers grounded in your stored activity data.');
        expect(footerIcons.length).toBe(1);
        expect(firebaseIcon).toBeTruthy();
        expect(contactLink).toBeTruthy();
        expect(contactLink?.textContent).toContain('Contact');
        expect(contactLink?.getAttribute('href')).toBe('mailto:support@quantified-self.io');
        expect(text).toContain('Integrations');
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
            if (section.classList.contains('app-footer')) {
                return 'footer';
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
            'footer',
        ]);
    });

    it('should render expanded integration capability cards with one integrations hub link', () => {
        const text = fixture.nativeElement.textContent as string;
        const integrationCards = fixture.nativeElement.querySelectorAll('.integration-followup-grid .feature-card');
        const integrationLinks = fixture.nativeElement.querySelectorAll(
            'a[href="/integrations"], a[routerlink="/integrations"], a[ng-reflect-router-link="/integrations"]'
        );

        expect(integrationCards.length).toBe(5);
        expect(text).toContain('Garmin -> Suunto and COROS -> Suunto sync are built in');
        expect(text).toContain('Automatic Sync for All Services');
        expect(text).toContain('Automatic Sync Between Services');
        expect(text).toContain('Manual Route Uploads');
        expect(text).toContain('Manual Activity Uploads to Suunto');
        expect(text).toContain('reliable and instant sync');
        expect(text).toContain('Explore Integrations');
        expect(integrationLinks.length).toBeGreaterThanOrEqual(1);
        expect(text).not.toContain('Set up sync');
        expect(text).not.toContain('How it works');
        expect(fixture.nativeElement.querySelector('.garmin-suunto-launch')).toBeNull();
    });

    it('should surface KPI and derived metric charts in Engineered for Performance section', () => {
        const text = fixture.nativeElement.textContent as string;
        const performanceCards = fixture.nativeElement.querySelectorAll(
            '.features-section:not(.ai-insights-section) .features-grid .feature-card'
        );
        const metricChips = fixture.nativeElement.querySelectorAll('.metric-chip');
        const metricChipInfoIcons = fixture.nativeElement.querySelectorAll('.metric-chip .metric-chip-info');

        expect(performanceCards.length).toBe(5);
        expect(metricChips.length).toBe(27);
        expect(metricChipInfoIcons.length).toBe(27);
        expect(text).toContain('Engineered for Performance');
        expect(text).toContain('Reliable and instant analytics');
        expect(text).toContain('KPI Lane for Fast Decisions');
        expect(text).toContain('Load Status');
        expect(text).toContain('ACWR');
        expect(text).toContain('Ramp Rate');
        expect(text).toContain('Monotony / Strain');
        expect(text).toContain('Form Now');
        expect(text).toContain('Fitness Trend');
        expect(text).toContain('Fatigue Trend');
        expect(text).toContain('Recovery Debt');
        expect(text).toContain('Form +7d');
        expect(text).toContain('Fitness (CTL)');
        expect(text).toContain('Fatigue (ATL)');
        expect(text).toContain('Training Balance');
        expect(text).toContain('Easy %');
        expect(text).toContain('Hard %');
        expect(text).toContain('Efficiency Δ (4w)');
        expect(text).toContain('Recovery');
        expect(text).toContain('Form (TSS)');
        expect(text).toContain('Freshness Forecast');
        expect(text).toContain('Intensity Distribution');
        expect(text).toContain('Efficiency Trend');
        expect(text).toContain('Sleep');
        expect(text).not.toContain('Training Load & Readiness Engine');
        expect(text).not.toContain('Derived metrics turn your activity history into load, fatigue, form, recovery, ramp, and intensity signals');
        expect(text).not.toContain('Form Model (CTL / ATL / TSB)');
        expect(text).toContain('Dashboard Manager by Category');
        expect(text).toContain('Manual');
        expect(text).toContain('Presets');
        expect(text).toContain('Curated');
        expect(text).toContain('KPI');
        expect(text).toContain('Custom');
        expect(text).toContain('Map');
        expect(text).toContain('clustered heatmaps');
    });

    it('should explain benchmark merge and hardware precision workflows', () => {
        const text = fixture.nativeElement.textContent as string;
        const analysisCards = fixture.nativeElement.querySelectorAll('.analysis-section .analysis-card');

        expect(analysisCards.length).toBe(3);
        expect(text).toContain('Hardware-Grade Precision');
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
        expect(text).not.toContain('Benchmark your devices with high-fidelity trace comparison.');
        expect(text).not.toContain('Sync Quality');
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
