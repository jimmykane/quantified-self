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
        expect(text).toContain('Quantify. Analyze. Improve.');
        expect(text).toContain('Measure Performance. Get AI Insights.');
        expect(text).toContain('AI Insights');
        expect(text).not.toContain('New Feature');
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
