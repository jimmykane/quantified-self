import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef, MatDialogState } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppHapticsService } from '../../services/app.haptics.service';
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
  const dialogRefMock = { close: vi.fn(), getState: vi.fn(() => MatDialogState.OPEN) };
  const hapticsMock = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    windowRef.location.href = '';
    dialogRefMock.getState.mockReturnValue(MatDialogState.OPEN);
    userServiceMock.getCurrentUserServiceTokenAndRedirectURI.mockResolvedValue({
      redirect_uri: 'https://wahoo.example/authorize',
    });

    await TestBed.configureTestingModule({
      imports: [WahooRouteAccessReconnectDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: AppHapticsService, useValue: hapticsMock },
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
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
    expect(hapticsMock.success).not.toHaveBeenCalled();
  });

  it('keeps the dialog usable when starting reconnect fails', async () => {
    const failure = new Error('Network unavailable');
    userServiceMock.getCurrentUserServiceTokenAndRedirectURI.mockRejectedValueOnce(failure);

    await component.reconnect();

    expect(component.reconnecting()).toBe(false);
    expect(hapticsMock.error).toHaveBeenCalledTimes(1);
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
  it('is silent on initialization and gives selection feedback for Not now', () => {
    fixture.detectChanges();
    expect(hapticsMock.selection).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('[mat-dialog-close]').click();
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
    expect(userServiceMock.getCurrentUserServiceTokenAndRedirectURI).not.toHaveBeenCalled();
  });

  it('keeps duplicate reconnect attempts silent while opening Wahoo', async () => {
    let finish!: (value: { redirect_uri: string }) => void;
    userServiceMock.getCurrentUserServiceTokenAndRedirectURI.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const reconnecting = component.reconnect();
    await component.reconnect();
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
    expect(userServiceMock.getCurrentUserServiceTokenAndRedirectURI).toHaveBeenCalledTimes(1);
    finish({ redirect_uri: 'https://wahoo.example/authorize' });
    await reconnecting;
  });

  it.each([
    ['success', 'closing'], ['failure', 'closing'],
    ['success', 'destroyed'], ['failure', 'destroyed'],
  ])('discards a late reconnect %s when the dialog is %s', async (outcome, state) => {
    let finish!: (value: { redirect_uri: string }) => void;
    let fail!: (reason: unknown) => void;
    userServiceMock.getCurrentUserServiceTokenAndRedirectURI.mockReturnValueOnce(new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const reconnecting = component.reconnect();
    if (state === 'destroyed') {
      fixture.destroy();
    } else {
      dialogRefMock.getState.mockReturnValue(MatDialogState.CLOSING);
    }
    if (outcome === 'success') {
      finish({ redirect_uri: 'https://wahoo.example/authorize' });
    } else {
      fail(new Error('Network unavailable'));
    }
    await reconnecting;
    expect(windowRef.location.href).toBe('');
    expect(snackBarMock.open).not.toHaveBeenCalled();
    expect(hapticsMock.error).not.toHaveBeenCalled();
    expect(hapticsMock.success).not.toHaveBeenCalled();
  });

});
