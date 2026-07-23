import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppUserService } from '../../services/app.user.service';
import { AppWindowService } from '../../services/app.window.service';
import { LoggerService } from '../../services/logger.service';
import { WahooRouteAccessReconnectDialogComponent } from './wahoo-route-access-reconnect-dialog.component';

describe('WahooRouteAccessReconnectDialogComponent', () => {
  let component: WahooRouteAccessReconnectDialogComponent;
  let fixture: ComponentFixture<WahooRouteAccessReconnectDialogComponent>;

  const windowRef = { location: { href: '' } };
  const userServiceMock = {
    getCurrentUserServiceTokenAndRedirectURI: vi.fn(),
  };
  const analyticsServiceMock = { logEvent: vi.fn() };
  const snackBarMock = { open: vi.fn() };
  const loggerMock = { error: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    windowRef.location.href = '';
    userServiceMock.getCurrentUserServiceTokenAndRedirectURI.mockResolvedValue({
      redirect_uri: 'https://wahoo.example/authorize',
    });

    await TestBed.configureTestingModule({
      imports: [WahooRouteAccessReconnectDialogComponent],
      providers: [
        { provide: AppUserService, useValue: userServiceMock },
        { provide: AppWindowService, useValue: { windowRef } },
        { provide: AppAnalyticsService, useValue: analyticsServiceMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: LoggerService, useValue: loggerMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WahooRouteAccessReconnectDialogComponent);
    component = fixture.componentInstance;
  });

  it('starts the Wahoo OAuth reconnect flow from the dialog', async () => {
    await component.reconnect();

    expect(userServiceMock.getCurrentUserServiceTokenAndRedirectURI).toHaveBeenCalledWith(ServiceNames.WahooAPI);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('service_reconnect_start', {
      service_name: ServiceNames.WahooAPI,
      source: 'route_access_dialog',
    });
    expect(windowRef.location.href).toBe('https://wahoo.example/authorize');
  });

  it('keeps the dialog usable when starting reconnect fails', async () => {
    const failure = new Error('Network unavailable');
    userServiceMock.getCurrentUserServiceTokenAndRedirectURI.mockRejectedValueOnce(failure);

    await component.reconnect();

    expect(component.reconnecting()).toBe(false);
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[WahooRouteAccessReconnectDialogComponent] Failed to start Wahoo reconnect',
      failure,
    );
    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Could not start Wahoo reconnect. Please try again.',
      undefined,
      { duration: 5000 },
    );
  });
});
