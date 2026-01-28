import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HomeComponent } from './home.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach } from 'vitest';

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
            declarations: [HomeComponent],
            imports: [
                MatIconModule,
                MatCardModule,
                MatButtonModule,
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
