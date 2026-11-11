import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { AppShellHeaderComponent } from './app-shell-header.component';
import { DashboardHeaderUploadComponent } from '../dashboard/dashboard-header-upload/dashboard-header-upload.component';
import { HistoryImportProgressService } from '../../services/history-import-progress.service';
import { computed, signal } from '@angular/core';
import { buildHistoryImportProgress } from '../../helpers/history-import-progress.helper';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatBadge, MatBadgeModule } from '@angular/material/badge';
import { By } from '@angular/platform-browser';
import { AppHapticsService } from '../../services/app.haptics.service';

describe('AppShellHeaderComponent', () => {
  let component: AppShellHeaderComponent;
  let fixture: ComponentFixture<AppShellHeaderComponent>;
  const haptics = { selection: vi.fn() };

  beforeEach(async () => {
    haptics.selection.mockClear();
    TestBed.overrideComponent(DashboardHeaderUploadComponent, {
      set: {
        imports: [],
        template: '',
      },
    });
    await TestBed.configureTestingModule({
      declarations: [AppShellHeaderComponent],
      imports: [NgComponentOutlet, MatBadgeModule],
      providers: [
        {provide: AppHapticsService, useValue: haptics},
        {provide: HistoryImportProgressService, useValue: {owner: signal(null), view: computed(() => buildHistoryImportProgress([], Date.now())), refreshing: signal(false)}},
        {provide: MatDialog, useValue: {}}, {provide: MatBottomSheet, useValue: {}},
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(AppShellHeaderComponent);
    component = fixture.componentInstance;
  });

  it.each([1, 22])('groups %i unread releases into one badge', (unreadCount) => {
    component.authState = false;
    fixture.componentRef.setInput('unreadWhatsNewCount', unreadCount);
    fixture.detectChanges();

    const icon = fixture.debugElement.query(By.css('.qs-app-badge[matBadge]'));
    expect(icon.injector.get(MatBadge).content).toBe('1');
    expect(icon.injector.get(MatBadge).hidden).toBe(false);
    expect(icon.nativeElement.querySelector('.mat-badge-content').textContent).toBe('1');
    expect(fixture.nativeElement.querySelector('button[aria-label^="View updates"]').getAttribute('aria-label'))
      .toContain('Unread release notes');
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it.each([
    { unread: 0, update: false },
    { unread: 22, update: false },
    { unread: 0, update: true },
    { unread: 22, update: true },
  ])('renders independent release/update badges for $unread unread and update=$update', ({ unread, update }) => {
    component.authState = false;
    fixture.componentRef.setInput('unreadWhatsNewCount', unread);
    fixture.componentRef.setInput('isUpdateAvailable', update);
    fixture.detectChanges();

    const badges = fixture.debugElement.queryAll(By.directive(MatBadge));
    // Material hides all descendant badge contents when a badge host is hidden.
    expect(badges[0].nativeElement.parentElement).toBe(badges[1].nativeElement.parentElement);
    const updateBadge = badges[0].injector.get(MatBadge);
    const releaseBadge = badges[1].injector.get(MatBadge);
    expect(updateBadge.hidden).toBe(!update);
    expect(updateBadge.position).toBe('above before');
    expect(updateBadge.content).toBe('1');
    expect(updateBadge.size).toBe('medium');
    expect(releaseBadge.hidden).toBe(unread === 0);
    expect(releaseBadge.position).toBe('above after');
    expect(releaseBadge.size).toBe('medium');
    const label = fixture.nativeElement.querySelector('button[aria-label^="View updates"]').getAttribute('aria-label');
    expect(label.includes('Unread release notes')).toBe(unread > 0);
    expect(label.includes('App update available')).toBe(update);
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('keeps the update badge after opening the tray and marking releases as read', () => {
    component.authState = false;
    fixture.componentRef.setInput('unreadWhatsNewCount', 22);
    fixture.componentRef.setInput('isUpdateAvailable', true);
    const open = vi.spyOn(component.whatsNewClick, 'emit');
    fixture.detectChanges();

    fixture.nativeElement.querySelector('button[aria-label^="View updates"]').click();
    expect(open).toHaveBeenCalledOnce();
    expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('unreadWhatsNewCount', 0);
    fixture.detectChanges();

    const badges = fixture.debugElement.queryAll(By.directive(MatBadge));
    expect(badges[0].injector.get(MatBadge).hidden).toBe(false);
    expect(badges[1].injector.get(MatBadge).hidden).toBe(true);

    fixture.componentRef.setInput('isUpdateAvailable', false);
    fixture.detectChanges();
    expect(badges[0].injector.get(MatBadge).hidden).toBe(true);
    expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it('keeps an available app update reachable while authentication is pending', () => {
    fixture.detectChanges();
    expect(component.authState).toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label^="View updates"]')).toBeNull();

    fixture.componentRef.setInput('isUpdateAvailable', true);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button[aria-label^="View updates"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toContain('App update available');
    expect(haptics.selection).not.toHaveBeenCalled();
    const open = vi.spyOn(component.whatsNewClick, 'emit');
    button?.click();
    expect(open).toHaveBeenCalledOnce();
    expect(haptics.selection).toHaveBeenCalledOnce();

    fixture.componentRef.setInput('isUpdateAvailable', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[aria-label^="View updates"]')).toBeNull();
    expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it('should hide header when host hidden class is present', () => {
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.classList.add('app-shell-header--hidden');
    fixture.detectChanges();

    const nav = fixture.nativeElement.querySelector('nav.custom-header') as HTMLElement | null;
    expect(nav).toBeTruthy();
    expect(host.classList.contains('app-shell-header--hidden')).toBe(true);
  });

  it('should emit toggleSidenav when hamburger button is clicked', () => {
    const emitSpy = vi.spyOn(component.toggleSidenav, 'emit');
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button.hamburger-link') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    button?.click();

    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('should render both signed-out desktop and mobile primary actions', () => {
    component.authState = false;
    fixture.detectChanges();

    const desktopActionButton = fixture.nativeElement.querySelector('button.responsive-action-button--desktop') as HTMLButtonElement | null;
    const mobileActionButton = fixture.nativeElement.querySelector('button.responsive-action-button--mobile') as HTMLButtonElement | null;
    const mobileIcon = mobileActionButton?.querySelector('mat-icon');

    expect(desktopActionButton?.textContent?.trim()).toBe('Login or Register');
    expect(mobileActionButton?.getAttribute('aria-label')).toBe('Login or Register');
    expect(mobileIcon?.textContent?.trim()).toBe('login');
  });

  it('should render both authenticated desktop and mobile primary actions', () => {
    component.authState = true;
    fixture.detectChanges();

    const desktopActionButton = fixture.nativeElement.querySelector('button.responsive-action-button--desktop') as HTMLButtonElement | null;
    const mobileActionButton = fixture.nativeElement.querySelector('button.responsive-action-button--mobile') as HTMLButtonElement | null;
    const mobileIcon = mobileActionButton?.querySelector('mat-icon');

    expect(desktopActionButton?.textContent?.trim()).toBe('Dashboard');
    expect(mobileActionButton?.getAttribute('aria-label')).toBe('Dashboard');
    expect(mobileIcon?.textContent?.trim()).toBe('dashboard');
  });

  it('only creates the dashboard upload host when the dashboard upload action is visible', async () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-dashboard-header-upload')).toBeNull();

    component.showUploadActivities = true;
    fixture.detectChanges();
    await component['dashboardHeaderUploadLoad'];
    fixture.detectChanges();

    expect(component.dashboardHeaderUploadComponent()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-dashboard-header-upload')).toBeTruthy();
  });

  it('only loads history status for authenticated chrome and clears it on sign-out', async () => {
    fixture.detectChanges(); expect(component.historyImportComponent()).toBeNull();
    component.authState = true;
    await component['historyImportLoad']; fixture.detectChanges();
    expect(component.historyImportComponent()).not.toBeNull();
    component.authState = false; fixture.detectChanges();
    expect(component.historyImportComponent()).toBeNull();
    expect(fixture.nativeElement.querySelector('app-history-import-indicator')).toBeNull();
  });

  it('does not install a delayed status component after sign-out or teardown', async () => {
    component.authState = true; component.authState = false;
    await component['historyImportLoad'];
    expect(component.historyImportComponent()).toBeNull();
    component.authState = true; fixture.destroy();
    await component['historyImportLoad'];
    expect(fixture.nativeElement.querySelector('app-history-import-indicator')).toBeNull();
  });
});
