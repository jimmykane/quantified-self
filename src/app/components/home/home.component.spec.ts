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
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getAiInsightsHeroPrompts } from '@shared/ai-insights-prompts';
import { TypedPromptRotatorComponent } from '../shared/typed-prompt-rotator/typed-prompt-rotator.component';

describe('HomeComponent', () => {
    let component: HomeComponent;
    let fixture: ComponentFixture<HomeComponent>;
    let mockAuthService: any;
    let mockRouter: any;

    beforeEach(async () => {
        mockAuthService = {
            getUser: vi.fn().mockResolvedValue(null)
        };

        mockRouter = {
            navigate: vi.fn()
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

    it('should keep the original hero messaging and render the AI Insights section', () => {
        const text = fixture.nativeElement.textContent as string;
        const footerIcons = Array.from(
            fixture.nativeElement.querySelectorAll('.tech-stack mat-icon')
        ) as HTMLElement[];
        const firebaseIcon = fixture.nativeElement.querySelector('.tech-stack mat-icon[svgIcon="firebase"]');
        const contactLink = fixture.nativeElement.querySelector('.legal-links a[href="mailto:support@quantified-self.io"]') as HTMLElement | null;
        expect(text).toContain('Quantify. Analyze. Improve.');
        expect(text).toContain('Measure Performance. Get AI Insights.');
        expect(text).toContain('AI Insights');
        expect(footerIcons.length).toBe(1);
        expect(firebaseIcon).toBeTruthy();
        expect(contactLink).toBeTruthy();
        expect(contactLink?.textContent).toContain('Contact');
        expect(contactLink?.getAttribute('href')).toBe('mailto:support@quantified-self.io');
        expect(text).not.toContain('New Feature');
    });

    it('should render expanded integration capability cards without dedicated CTA promotion', () => {
        const text = fixture.nativeElement.textContent as string;
        const integrationCards = fixture.nativeElement.querySelectorAll('.integration-followup-grid .feature-card');

        expect(integrationCards.length).toBe(5);
        expect(text).toContain('Garmin -> Suunto and COROS -> Suunto sync are built in');
        expect(text).toContain('Automatic Sync for All Services');
        expect(text).toContain('Automatic Sync Between Services');
        expect(text).toContain('Manual Route Uploads');
        expect(text).toContain('Manual Activity Uploads to Suunto');
        expect(text).toContain('reliable and instant sync');
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

        expect(performanceCards.length).toBe(6);
        expect(metricChips.length).toBe(11);
        expect(metricChipInfoIcons.length).toBe(11);
        expect(text).toContain('Engineered for Performance');
        expect(text).toContain('Reliable and instant analytics');
        expect(text).toContain('KPI Lane for Fast Decisions');
        expect(text).toContain('ACWR');
        expect(text).toContain('Ramp Rate');
        expect(text).toContain('Monotony / Strain');
        expect(text).toContain('Form Now');
        expect(text).toContain('Form +7d');
        expect(text).toContain('Easy %');
        expect(text).toContain('Hard %');
        expect(text).toContain('Efficiency Δ (4w)');
        expect(text).toContain('Freshness Forecast');
        expect(text).toContain('Intensity Distribution');
        expect(text).toContain('Efficiency Trend');
        expect(text).toContain('Form Model (CTL / ATL / TSB)');
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
