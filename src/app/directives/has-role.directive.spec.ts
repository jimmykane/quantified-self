import { Component, DebugElement } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HasRoleDirective } from './has-role.directive';
import { AppUserService } from '../services/app.user.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { signal } from '@angular/core';
import { LoggerService } from '../services/logger.service';
import { Firestore } from '@angular/fire/firestore';

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
    let userServiceStub: { hasPaidAccessSignal: any, isProSignal: any };

    beforeEach(async () => {
        userServiceStub = {
            hasPaidAccessSignal: signal(false),
            isProSignal: signal(false)
        };

        await TestBed.configureTestingModule({
            imports: [HasRoleTestComponent, HasRoleDirective],
            providers: [
                { provide: AppUserService, useValue: userServiceStub },
                { provide: LoggerService, useValue: { error: vi.fn() } },
                { provide: Firestore, useValue: {} }
            ]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(HasRoleTestComponent);
    });

    it('should display basic content for Basic user', async () => {
        userServiceStub.hasPaidAccessSignal.set(true);
        userServiceStub.isProSignal.set(false);

        fixture.detectChanges();

        const basicEl = fixture.debugElement.query(By.css('.basic-content'));
        const proEl = fixture.debugElement.query(By.css('.pro-content'));

        expect(basicEl).toBeTruthy();
        expect(proEl).toBeNull();
    });

    it('should display all content for Pro user', async () => {
        userServiceStub.hasPaidAccessSignal.set(true);
        userServiceStub.isProSignal.set(true);

        fixture.detectChanges();

        const basicEl = fixture.debugElement.query(By.css('.basic-content'));
        const proEl = fixture.debugElement.query(By.css('.pro-content'));

        expect(basicEl).toBeTruthy(); // Pro satisfies 'basic' requirement too
        expect(proEl).toBeTruthy();
    });

    it('should hide all content for Free user', async () => {
        userServiceStub.hasPaidAccessSignal.set(false);
        userServiceStub.isProSignal.set(false);

        fixture.detectChanges();

        const basicEl = fixture.debugElement.query(By.css('.basic-content'));
        const proEl = fixture.debugElement.query(By.css('.pro-content'));

        expect(basicEl).toBeNull();
        expect(proEl).toBeNull();
    });
});
