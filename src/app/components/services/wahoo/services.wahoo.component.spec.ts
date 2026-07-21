import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppFileService } from '../../../services/app.file.service';
import { AppFunctionsService } from '../../../services/app.functions.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { LoggerService } from '../../../services/logger.service';
import { ServicesWahooComponent } from './services.wahoo.component';

describe('ServicesWahooComponent', () => {
  let fixture: ComponentFixture<ServicesWahooComponent>;
  let component: ServicesWahooComponent;
  let userService: { requestAndSetCurrentUserWahooAPIAccessToken: ReturnType<typeof vi.fn> };
  let functionsService: { call: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    userService = {
      requestAndSetCurrentUserWahooAPIAccessToken: vi.fn().mockResolvedValue(undefined),
    };
    functionsService = { call: vi.fn().mockResolvedValue({ data: { providerUserId: null } }) };
    await TestBed.configureTestingModule({
      declarations: [ServicesWahooComponent],
      providers: [
        { provide: HttpClient, useValue: {} },
        { provide: AppFileService, useValue: {} },
        { provide: AppFunctionsService, useValue: functionsService },
        { provide: AppEventService, useValue: {} },
        { provide: AppAuthService, useValue: {} },
        { provide: AppUserService, useValue: userService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ state: 'state-1', code: 'code-1' }) } },
        },
        { provide: AppWindowService, useValue: { windowRef: { location: { href: '' } } } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        { provide: AppAnalyticsService, useValue: { logEvent: vi.fn() } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ServicesWahooComponent);
    component = fixture.componentInstance;
  });

  it('uses safe connection metadata and hides preserved credentials during pending disconnect', () => {
    component.serviceMeta = { connectionState: 'connected' } as any;
    expect(component.isConnectedToService()).toBe(true);

    component.serviceMeta = { connectionState: 'disconnect_pending' } as any;
    component.serviceTokens = [{ accessToken: 'server-only-token' } as any];

    expect(component.isDisconnectPending).toBe(true);
    expect(component.isConnectedToService()).toBe(false);
    expect(component.connectionDescription).toContain('Disconnect is pending');
  });

  it('shows the safe Wahoo account ID instead of a generic connected label', () => {
    component.serviceMeta = { connectionState: 'connected', providerUserId: '60462' } as any;
    (component as any).onServiceDataChanged();

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Wahoo account ID: 60462');
    expect(fixture.nativeElement.textContent).not.toContain('Wahoo account connected');
    expect(functionsService.call).not.toHaveBeenCalled();
  });

  it('hydrates an existing connection account ID from the server-only token record once', async () => {
    functionsService.call.mockResolvedValue({ data: { providerUserId: '60462' } });
    component.serviceMeta = { connectionState: 'connected' } as any;

    (component as any).onServiceDataChanged();
    await vi.waitFor(() => expect(component.wahooAccountId()).toBe('60462'));

    expect(functionsService.call).toHaveBeenCalledWith('getWahooAPIConnectionAccount');
    expect(component.isLoadingWahooAccountId()).toBe(false);
  });

  it('allows disconnect after Pro access ends while keeping connect Pro-only', () => {
    component.hasProAccess = false;

    expect(component.canConnectServiceWithCurrentAccess).toBe(false);
    expect((component as any).canDisconnectWithoutProAccess).toBe(true);
  });

  it('keeps non-Pro upsell actions keyboard-accessible through Material buttons', () => {
    component.user = {} as any;
    component.hasProAccess = false;
    component.showAdvancedTools = true;
    const upsell = vi.spyOn(component, 'triggerUpsell').mockImplementation(() => undefined);

    fixture.detectChanges();

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const connectUpsell = buttons.find(button => button.textContent?.includes('View Pro plans'));
    const historyUpsell = buttons.find(button => button.textContent?.includes('Wahoo history import is a Pro feature'));
    expect(connectUpsell?.disabled).toBe(false);
    expect(historyUpsell).toBeTruthy();

    connectUpsell?.click();
    historyUpsell?.click();
    expect(upsell).toHaveBeenCalledTimes(2);
  });

  it('exchanges the Wahoo callback state and code through the user service', async () => {
    expect(component.serviceName).toBe(ServiceNames.WahooAPI);

    await component.requestAndSetToken();

    expect(userService.requestAndSetCurrentUserWahooAPIAccessToken).toHaveBeenCalledWith('state-1', 'code-1');
  });

  it('renders history tools without duplicating the connection summary in a focused dialog', () => {
    component.showAdvancedTools = true;
    component.showConnectionSummary = false;
    component.showOnlyActiveProviderTool = true;
    component.activeProviderTool = 'history';

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-service-connection-status')).toBeNull();
    expect(fixture.nativeElement.querySelector('.service-container--tools-only')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.provider-tool-panel')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.tool-subsection-title')).toBeNull();
  });

  it('offers direct FIT delivery without implying that it creates a Quantified Self activity', () => {
    component.user = {} as any;
    component.hasProAccess = true;
    component.serviceMeta = { connectionState: 'connected' } as any;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Send FIT Activity to Wahoo');
    expect(fixture.nativeElement.textContent).toContain('does not create or retain an activity in Quantified Self');
    expect(fixture.nativeElement.querySelector('app-upload-activity-to-service')).toBeTruthy();
  });

  it('renders direct FIT delivery in the focused uploads tool', () => {
    component.user = {} as any;
    component.hasProAccess = true;
    component.serviceMeta = { connectionState: 'connected' } as any;
    component.showAdvancedTools = true;
    component.showConnectionSummary = false;
    component.showOnlyActiveProviderTool = true;
    component.activeProviderTool = 'uploads';

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.provider-tool-panel')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-upload-activity-to-service')).toBeTruthy();
  });

  it('renders the shared Wahoo-to-Suunto activity sync control in the focused activity sync tool', () => {
    component.user = {} as any;
    component.hasProAccess = true;
    component.serviceMeta = { connectionState: 'connected' } as any;
    component.showAdvancedTools = true;
    component.showConnectionSummary = false;
    component.showOnlyActiveProviderTool = true;
    component.activeProviderTool = 'auto-sync';

    fixture.detectChanges();

    const routeControl = fixture.nativeElement.querySelector('app-activity-sync-route-control');
    expect(routeControl).toBeTruthy();
    expect(routeControl.sourceServiceName).toBe(ServiceNames.WahooAPI);
    expect(routeControl.destinationServiceName).toBe(ServiceNames.SuuntoApp);
  });

  it('rejects a denied Wahoo authorization callback instead of reporting a connection', async () => {
    (component as any).route.snapshot.queryParamMap = convertToParamMap({
      state: 'state-1',
      error: 'access_denied',
    });

    await expect(component.requestAndSetToken()).rejects.toThrow('Wahoo authorization was not completed.');
    expect(userService.requestAndSetCurrentUserWahooAPIAccessToken).not.toHaveBeenCalled();
  });

  it('rejects an incomplete Wahoo authorization callback', async () => {
    (component as any).route.snapshot.queryParamMap = convertToParamMap({ state: 'state-1' });

    await expect(component.requestAndSetToken()).rejects.toThrow('missing state or code');
    expect(userService.requestAndSetCurrentUserWahooAPIAccessToken).not.toHaveBeenCalled();
  });
});
