import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PremiumOnlyDirective } from './premium-only.directive';
import { AppUserService } from '../services/app.user.service';
import { By } from '@angular/platform-browser';

@Component({
    template: `<div *appPremiumOnly>Premium Content</div>`,
    standalone: true,
    imports: [PremiumOnlyDirective]
})
class TestComponent { }

describe('PremiumOnlyDirective', () => {
    let fixture: ComponentFixture<TestComponent>;
    let userServiceSpy: jasmine.SpyObj<AppUserService>;

    beforeEach(() => {
        userServiceSpy = jasmine.createSpyObj('AppUserService', ['isPremium']);

        TestBed.configureTestingModule({
            imports: [TestComponent, PremiumOnlyDirective],
            providers: [
                { provide: AppUserService, useValue: userServiceSpy }
            ]
        });

        fixture = TestBed.createComponent(TestComponent);
    });

    it('should show content if user is premium', async () => {
        userServiceSpy.isPremium.and.returnValue(Promise.resolve(true));
        fixture.detectChanges(); // Trigger ngOnInit
        await fixture.whenStable(); // Wait for async ngOnInit
        fixture.detectChanges(); // Update view with result

        const element = fixture.debugElement.query(By.css('div'));
        expect(element).toBeTruthy();
        expect(element.nativeElement.textContent).toContain('Premium Content');
    });

    it('should hide content if user is not premium', async () => {
        userServiceSpy.isPremium.and.returnValue(Promise.resolve(false));
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const element = fixture.debugElement.query(By.css('div'));
        expect(element).toBeFalsy();
    });
});
