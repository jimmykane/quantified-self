import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProOnlyDirective } from './pro-only.directive';
import { AppUserService } from '../services/app.user.service';
import { By } from '@angular/platform-browser';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { signal } from '@angular/core';
import { LoggerService } from '../services/logger.service';
import { Firestore } from '@angular/fire/firestore';

@Component({
    template: `<div *appProOnly>Pro Content</div>`,
    standalone: true,
    imports: [ProOnlyDirective]
})
class TestComponent { }

describe('ProOnlyDirective', () => {
    let fixture: ComponentFixture<TestComponent>;
    let mockUserService: { isProSignal: any };

    beforeEach(async () => {
        mockUserService = {
            isProSignal: signal(false)
        };

        await TestBed.configureTestingModule({
            imports: [TestComponent, ProOnlyDirective],
            providers: [
                { provide: AppUserService, useValue: mockUserService },
                { provide: LoggerService, useValue: { error: vi.fn() } },
                { provide: Firestore, useValue: {} }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(TestComponent);
    });

    it('should show content if user is pro', async () => {
        mockUserService.isProSignal.set(true);
        fixture.detectChanges();

        const element = fixture.debugElement.query(By.css('div'));
        expect(element).toBeTruthy();
        expect(element.nativeElement.textContent).toContain('Pro Content');
    });

    it('should hide content if user is not pro', async () => {
        mockUserService.isProSignal.set(false);
        fixture.detectChanges();

        const element = fixture.debugElement.query(By.css('div'));
        expect(element).toBeFalsy();
    });
});
