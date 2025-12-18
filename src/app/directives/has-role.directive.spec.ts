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
    <div class="pro-content" *appHasRole="'pro'">Pro Content</div>
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
            isPro: vi.fn()
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
        userServiceStub.isPro.mockResolvedValue(false);

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const basicEl = fixture.debugElement.query(By.css('.basic-content'));
        const proEl = fixture.debugElement.query(By.css('.pro-content'));

        expect(basicEl).toBeTruthy();
        expect(proEl).toBeNull();
    });

    it('should display all content for Pro user', async () => {
        userServiceStub.hasPaidAccess.mockResolvedValue(true);
        userServiceStub.isPro.mockResolvedValue(true);

        fixture.detectChanges();
        await fixture.whenStable(); // Wait for async ngOnInit
        fixture.detectChanges();

        const basicEl = fixture.debugElement.query(By.css('.basic-content'));
        const proEl = fixture.debugElement.query(By.css('.pro-content'));

        expect(basicEl).toBeTruthy(); // Pro satisfies 'basic' requirement too
        expect(proEl).toBeTruthy();
    });

    it('should hide all content for Free user', async () => {
        userServiceStub.hasPaidAccess.mockResolvedValue(false);
        userServiceStub.isPro.mockResolvedValue(false);

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const basicEl = fixture.debugElement.query(By.css('.basic-content'));
        const proEl = fixture.debugElement.query(By.css('.pro-content'));

        expect(basicEl).toBeNull();
        expect(proEl).toBeNull();
    });
});
