import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WhatsNewDialogComponent } from './whats-new-dialog.component';
import { AppWhatsNewService } from '../../services/app.whats-new.service';
import { AppUpdateService } from '../../services/app.update.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { MatDialogRef } from '@angular/material/dialog';
import { signal, type WritableSignal } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChangelogPost } from '../../services/app.whats-new.service';

describe('WhatsNewDialogComponent', () => {
    let component: WhatsNewDialogComponent;
    let fixture: ComponentFixture<WhatsNewDialogComponent>;
    let changelogsSignal: WritableSignal<ChangelogPost[]>;
    let mockWhatsNewService: any;
    let mockUpdateService: any;
    let mockAnalyticsService: any;
    let mockDialogRef: any;

    beforeEach(async () => {
        // Create a signal for changelogs
        changelogsSignal = signal<ChangelogPost[]>([]);
        mockWhatsNewService = {
            markAsRead: vi.fn(),
            changelogs: changelogsSignal,
            isUnread: vi.fn().mockReturnValue(false)
        };

        // Create a signal for isUpdateAvailable
        const updateAvailableSignal = signal(false);
        mockUpdateService = {
            isUpdateAvailable: updateAvailableSignal,
            activateUpdate: vi.fn(),
            setUpdateAvailable: (val: boolean) => updateAvailableSignal.set(val) // Helper for tests
        };

        mockAnalyticsService = {
            logEvent: vi.fn()
        };

        mockDialogRef = {
            close: vi.fn()
        };

        await TestBed.configureTestingModule({
            imports: [WhatsNewDialogComponent, RouterTestingModule, NoopAnimationsModule],
            providers: [
                { provide: AppWhatsNewService, useValue: mockWhatsNewService },
                { provide: AppUpdateService, useValue: mockUpdateService },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService },
                { provide: MatDialogRef, useValue: mockDialogRef }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(WhatsNewDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should mark changelog as read on init', () => {
        expect(mockWhatsNewService.markAsRead).toHaveBeenCalled();
    });

    it('should log click_whats_new event on init', () => {
        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('click_whats_new');
    });

    it('should NOT show update banner when update is not available', () => {
        mockUpdateService.setUpdateAvailable(false);
        fixture.detectChanges();
        const banner = fixture.nativeElement.querySelector('.update-banner');
        expect(banner).toBeNull();
    });

    it('should show update banner when update is available', () => {
        mockUpdateService.setUpdateAvailable(true);
        fixture.detectChanges();
        const banner = fixture.nativeElement.querySelector('.update-banner');
        expect(banner).toBeTruthy();
        expect(banner.textContent).toContain('New version available');
    });

    it('should call activateUpdate when reload button is clicked', () => {
        mockUpdateService.setUpdateAvailable(true);
        fixture.detectChanges();

        const reloadBtn = fixture.nativeElement.querySelector('.update-banner button');
        reloadBtn.click();

        expect(mockUpdateService.activateUpdate).toHaveBeenCalled();
    });

    it('should use flush mobile content alignment only for the single-entry notification feed', () => {
        changelogsSignal.set([{
            id: 'release-1',
            title: 'Test release',
            description: 'Release details',
            date: new Date('2026-07-29T00:00:00Z'),
            type: 'minor',
            version: '1.0.0',
            published: true
        }]);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.changelog-panel-notification')).not.toBeNull();
    });
});
