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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ActivitySyncRouteControlComponent],
      providers: [
        { provide: AppUserService, useValue: userService },
        { provide: AppAnalyticsService, useValue: analyticsService },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: MatSnackBar, useValue: snackBar },
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

  it('shows a clear route header and both date fields for Wahoo activity sync', () => {
    fixture.detectChanges();

    const providerIcons = fixture.nativeElement.querySelectorAll('.activity-sync-route-control__provider-icons app-service-source-icon');
    const dateFields = fixture.nativeElement.querySelectorAll('.activity-sync-route-control__date-fields mat-form-field');

    expect(providerIcons).toHaveLength(2);
    expect(dateFields).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Send Garmin activities to Wahoo');
  });

  it('keeps the backfill loading spinner and label in one accessible button row', () => {
    component.isBackfilling = true;
    fixture.detectChanges();

    const action = fixture.nativeElement.querySelector('.activity-sync-route-control__action');
    const content = fixture.nativeElement.querySelector('.activity-sync-route-control__action-content');

    expect(action.getAttribute('aria-busy')).toBe('true');
    expect(content.querySelector('mat-spinner')).not.toBeNull();
    expect(content.textContent.trim()).toBe('Starting sync…');
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
