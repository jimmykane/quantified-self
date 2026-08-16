import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '@shared/route-delivery-sync-routes';
import { AppUserService } from '../../../services/app.user.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { LoggerService } from '../../../services/logger.service';
import { RouteDeliverySyncRouteControlComponent } from './route-delivery-sync-route-control.component';

describe('RouteDeliverySyncRouteControlComponent', () => {
  let fixture: ComponentFixture<RouteDeliverySyncRouteControlComponent>;
  let component: RouteDeliverySyncRouteControlComponent;
  const connectionState = new BehaviorSubject<Record<string, boolean>>({
    [ServiceNames.COROSAPI]: true,
  });
  const userService = {
    watchActivityServiceConnectionState: vi.fn(() => connectionState.asObservable()),
    getUserMetaForService: vi.fn(() => of(undefined)),
    updateRouteDeliverySyncRouteSettings: vi.fn().mockResolvedValue(undefined),
    backfillRouteDeliverySyncRouteForCurrentUser: vi.fn().mockResolvedValue({
      scanned: 4,
      queued: 3,
      skippedByReason: { already_synced: 1 },
      failedCount: 0,
      failedRoutes: [],
    }),
  };
  const analytics = { logEvent: vi.fn() };
  const snackBar = { open: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      declarations: [RouteDeliverySyncRouteControlComponent],
      providers: [
        { provide: AppUserService, useValue: userService },
        { provide: AppAnalyticsService, useValue: analytics },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: MatSnackBar, useValue: snackBar },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(RouteDeliverySyncRouteControlComponent);
    component = fixture.componentInstance;
    component.user = {
      uid: 'route-delivery-user',
      settings: {
        serviceSyncSettings: {
          routeDeliverySyncRoutes: {
            [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI]: { enabled: true },
          },
        },
      },
    } as any;
    component.hasProAccess = true;
    component.sourceServiceName = ServiceNames.SuuntoApp;
    component.destinationServiceName = ServiceNames.COROSAPI;
    component.sourceConnected = true;
    component.ngOnChanges();
  });

  it('uses the shared Suunto-to-COROS route definition and connection state', () => {
    expect(component.routeId).toBe(ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI);
    expect(component.routeAvailableForUser).toBe(true);
    expect(component.routeEnabled).toBe(true);
    expect(component.canUseRoute).toBe(true);
  });

  it('updates the opt-in route setting through the shared user service', async () => {
    await component.onRouteToggle(false);

    expect(userService.updateRouteDeliverySyncRouteSettings).toHaveBeenCalledWith(
      component.user,
      { [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI]: false },
    );
  });

  it('queues a saved-route backfill independently of the automatic toggle', async () => {
    await component.runBackfill({ preventDefault: vi.fn() } as unknown as Event);

    expect(userService.backfillRouteDeliverySyncRouteForCurrentUser).toHaveBeenCalledWith(
      ServiceNames.SuuntoApp,
      ServiceNames.COROSAPI,
    );
    expect(component.backfillSummary).toMatchObject({ scanned: 4, queued: 3 });
  });

  it('renders COROS route controls for another eligible user', () => {
    component.user = { uid: 'another-route-delivery-user' } as any;
    component.ngOnChanges();
    fixture.detectChanges();

    expect(component.routeAvailableForUser).toBe(true);
    expect(fixture.nativeElement.querySelector('.activity-sync-route-control')).not.toBeNull();
  });
});
