import { Component, DebugElement } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HasRoleDirective } from './has-role.directive';
import { AppUserService } from '../services/app.user.service';
import { vi, describe, it, expect } from 'vitest';

@Component({
    standalone: true,
    template: `
    <div class="basic-content" *appHasRole="'basic'">Basic Content</div>
    <div class="premium-content" *appHasRole="'premium'">Premium Content</div>
  `,
    imports: [HasRoleDirective]
})
class HasRoleTestComponent { }

describe('HasRoleDirective', () => {
    let fixture: ComponentFixture<HasRoleTestComponent>;
    let userServiceStub: { hasPaidAccess: ReturnType<typeof vi.fn>, isPremium: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        userServiceStub = {
            hasPaidAccess: vi.fn(),
            isPremium: vi.fn()
        };

        await TestBed.configureTestingModule({
            imports: [HasRoleTestComponent, HasRoleDirective],
            providers: [{ provide: AppUserService, useValue: userServiceStub }]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(HasRoleTestComponent);
    });

    it('should display basic content for Basic user', async () => {
        userServiceStub.hasPaidAccess.mockResolvedValue(true); // Basic satisfies hasPaidAccess
        userServiceStub.isPremium.mockResolvedValue(false);

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const basicEl = fixture.debugElement.query(By.css('.basic-content'));
        const premiumEl = fixture.debugElement.query(By.css('.premium-content'));

        expect(basicEl).toBeTruthy();
        expect(premiumEl).toBeNull();
    });

    it('should display all content for Premium user', async () => {
        userServiceStub.hasPaidAccess.mockResolvedValue(true);
        userServiceStub.isPremium.mockResolvedValue(true);

        fixture.detectChanges();
        await fixture.whenStable(); // Wait for async ngOnInit
        fixture.detectChanges();

        const basicEl = fixture.debugElement.query(By.css('.basic-content'));
        const premiumEl = fixture.debugElement.query(By.css('.premium-content'));

        expect(basicEl).toBeTruthy(); // Premium satisfies 'basic' requirement too
        expect(premiumEl).toBeTruthy();
    });

    it('should hide all content for Free user', async () => {
        userServiceStub.hasPaidAccess.mockResolvedValue(false);
        userServiceStub.isPremium.mockResolvedValue(false);

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const basicEl = fixture.debugElement.query(By.css('.basic-content'));
        const premiumEl = fixture.debugElement.query(By.css('.premium-content'));

        expect(basicEl).toBeNull();
        expect(premiumEl).toBeNull();
    });
});
