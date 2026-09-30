import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { ActivitySyncRouteControlComponent } from './activity-sync-route-control.component';
import { AppUserService } from '../../../services/app.user.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { LoggerService } from '../../../services/logger.service';
import { AppHapticsService } from '../../../services/app.haptics.service';

describe('ActivitySyncRouteControlComponent', () => {
  let component: ActivitySyncRouteControlComponent;
  let fixture: ComponentFixture<ActivitySyncRouteControlComponent>;

  const userService = {
    watchActivityServiceConnectionState: vi.fn(),
    getUserMetaForService: vi.fn(),
    updateActivitySyncRouteSettings: vi.fn(),
    backfillActivitySyncRouteForCurrentUser: vi.fn(),
  };
  const analyticsService = {
    logActivitySyncRouteToggle: vi.fn(),
    logActivitySyncRouteBackfill: vi.fn(),
  };
  const snackBar = { open: vi.fn() };
  const hapticsService = {
    selection: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ActivitySyncRouteControlComponent],
      providers: [
        { provide: AppUserService, useValue: userService },
        { provide: AppAnalyticsService, useValue: analyticsService },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AppHapticsService, useValue: hapticsService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    userService.watchActivityServiceConnectionState.mockReturnValue(of({
      [ServiceNames.GarminAPI]: true,
      [ServiceNames.SuuntoApp]: true,
      [ServiceNames.COROSAPI]: true,
      [ServiceNames.WahooAPI]: true,
    }));
    userService.getUserMetaForService.mockReturnValue(of({ connectionState: 'connected' }));
    userService.updateActivitySyncRouteSettings.mockResolvedValue(undefined);
    userService.backfillActivitySyncRouteForCurrentUser.mockResolvedValue({
      scanned: 2,
      queued: 2,
      skippedByReason: {},
      failedCount: 0,
      failedEvents: [],
    });
    vi.clearAllMocks();

    fixture = TestBed.createComponent(ActivitySyncRouteControlComponent);
    component = fixture.componentInstance;
    component.user = { uid: 'user-1', settings: { serviceSyncSettings: {} } } as any;
    component.hasProAccess = true;
    component.sourceServiceName = ServiceNames.GarminAPI;
    component.destinationServiceName = ServiceNames.WahooAPI;
    component.sourceConnected = true;
    component.ngOnChanges();
  });

  it('resolves the Garmin to Wahoo route and requires both connections', () => {
    expect(component.routeId).toBe(ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI);
    expect(component.destinationConnected).toBe(true);
    expect(component.canUseRoute).toBe(true);
  });

  it('resolves the Wahoo to Suunto route through the same control', () => {
    component.sourceServiceName = ServiceNames.WahooAPI;
    component.destinationServiceName = ServiceNames.SuuntoApp;
    component.ngOnChanges();

    expect(component.routeId).toBe(ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp);
    expect(component.sourceName).toBe('Wahoo');
    expect(component.destinationName).toBe('Suunto App');
    expect(component.canUseRoute).toBe(true);
  });

  it('shows a clear route header for Wahoo activity sync', () => {
    fixture.detectChanges();

    const providerIcons = fixture.nativeElement.querySelectorAll('.activity-sync-route-control__provider-icons app-service-source-icon');

    expect(providerIcons).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Send Garmin activities to Wahoo');
  });

  it('keeps historical sending out of automatic route controls', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Sync past activities');
    expect(fixture.nativeElement.querySelector('mat-slide-toggle')).toBeTruthy();
  });

  it('writes the specific route setting and analytics event when automatic delivery is enabled', async () => {
    await component.onRouteToggle(true);

    expect(userService.updateActivitySyncRouteSettings).toHaveBeenCalledWith(component.user, {
      [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI]: true,
    });
    expect(analyticsService.logActivitySyncRouteToggle).toHaveBeenCalledWith(
      ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      true,
    );
    expect(hapticsService.selection).toHaveBeenCalledOnce();
    expect(hapticsService.success).toHaveBeenCalledOnce();
  });

  it('does not enable delivery while Wahoo is disconnected', async () => {
    component.destinationConnected = false;

    await component.onRouteToggle(true);

    expect(userService.updateActivitySyncRouteSettings).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(
      expect.stringContaining('Connect Garmin and Wahoo'),
      undefined,
      expect.anything(),
    );
  });
});
