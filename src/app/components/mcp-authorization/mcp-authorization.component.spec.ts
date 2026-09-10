import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFunctionsService } from '../../services/app.functions.service';
import { AppWindowService } from '../../services/app.window.service';
import { LoggerService } from '../../services/logger.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { McpAuthorizationComponent } from './mcp-authorization.component';

describe('McpAuthorizationComponent', () => {
  const assign = vi.fn();
  const haptics = { selection: vi.fn() };
  const functions = {
    call: vi.fn(),
  };
  const windowRef = {
    location: { assign },
    navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    windowRef.navigator.userAgent = 'Mozilla/5.0 (X11; Linux x86_64)';
    functions.call.mockImplementation((name: string) => {
      if (name === 'getMcpAuthorizationRequest') {
        return Promise.resolve({
          data: {
            requestId: 'request-1',
            clientName: 'Training Copilot',
            clientIdHost: 'client.example',
            redirectUri: 'https://client.example/oauth/callback',
            redirectHost: 'client.example',
            scopes: [
              'health:read',
              'metrics:read',
              'measurements:read',
              'sleep:read',
              'activity-details:read',
              'activity-location:read',
              'routes:read',
              'route-location:read',
            ],
            expiresAtMs: Date.now() + 60_000,
            loopbackRedirect: false,
          },
        });
      }
      return Promise.resolve({
        data: { redirectUri: 'https://client.example/oauth/callback?code=code-1' },
      });
    });

    await TestBed.configureTestingModule({
      imports: [McpAuthorizationComponent, NoopAnimationsModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({ request_id: 'request-1' }),
            },
          },
        },
        { provide: AppFunctionsService, useValue: functions },
        { provide: AppWindowService, useValue: { windowRef } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: AppHapticsService, useValue: haptics },
      ],
    }).compileComponents();
  });

  it('shows the requesting client, redirect, and only the requested scopes', async () => {
    const fixture = TestBed.createComponent(McpAuthorizationComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const content = fixture.nativeElement.textContent as string;
    expect(content).toContain('Training Copilot');
    expect(content).toContain('https://client.example/oauth/callback');
    expect(content).toContain('Activity and Training metrics');
    expect(content).toContain('Body measurements');
    expect(content).toContain('Health metrics');
    expect(content).toContain('exact UTC times');
    expect(content).toContain('No measurements can be added, edited or deleted');
    expect(content).toContain('Read bounded identity-free body-measurement history such as weight');
    expect(content).toContain('exact source timestamps');
    expect(content).toContain('selected canonical numeric metrics for one activity');
    expect(content).toContain('Sleep summaries');
    expect(content).toContain('available aggregate HRV');
    expect(content).toContain('Individual activity details');
    expect(content).toContain('bounded on-demand chart series');
    expect(content).toContain('Activity locations');
    expect(content).toContain('exact activity start, end, MTB jump');
    expect(content).toContain('Saved-route summaries');
    expect(content).toContain('Saved-route locations and geometry');
    expect(content).toContain('preview geometry and segment endpoints');
    expect(content).toContain('waypoint coordinates');
    expect(content).toContain('location text to Mapbox');
    expect(content).toContain('direct-coordinate searches stay within Quantified Self');
    expect(content).toContain('Original files');
    expect(content).toContain('full-resolution recordings');
    expect(content).toContain('unrequested streams');
    expect(content).toContain('permissions are independent');
    expect(content).not.toContain('Android app handoff');
  });

  it('warns Android users before the client app-link handoff', async () => {
    windowRef.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 15; Pixel 9)';
    const fixture = TestBed.createComponent(McpAuthorizationComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const content = fixture.nativeElement.textContent as string;
    expect(content).toContain('Android app handoff');
    expect(content).toContain('ChatGPT opens but does not resume setup');
    expect(content).toContain('Open supported links');
    expect(content).toContain('finish setup in ChatGPT on the web from a desktop');
  });

  it('keeps descriptions opt-in and removes both child grants when activity details is unchecked', async () => {
    functions.call.mockResolvedValueOnce({ data: { requestId: 'description-request',
      scopes: ['activity-details:read', 'activity-descriptions:read', 'activity-location:read'],
      clientName: 'Description client', redirectUri: 'https://client.example/callback' } });
    const fixture = TestBed.createComponent(McpAuthorizationComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const option = () => component.scopeOptions().find(value => value.scope === 'activity-descriptions:read');
    expect(option()).toMatchObject({ title: 'Activity descriptions', selected: false, disabled: false });
    expect(fixture.nativeElement.textContent).toContain('location information, even without Activity locations');
    expect(haptics.selection).not.toHaveBeenCalled();
    component.toggleScope('activity-descriptions:read', { checked: true } as never);
    component.toggleScope('activity-descriptions:read', { checked: true } as never);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    await component.approve();
    expect(functions.call).toHaveBeenLastCalledWith('decideMcpAuthorization', {
      requestId: 'description-request', approved: true,
      grantedScopes: ['activity-details:read', 'activity-location:read', 'activity-descriptions:read'],
    });
    component.deciding.set(null);
    component.toggleScope('activity-details:read', { checked: false } as never);
    expect(component.selectedScopes()).toEqual([]);
    expect(option()).toMatchObject({ selected: false, disabled: true });
    component.toggleScope('activity-descriptions:read', { checked: true } as never);
    expect(component.selectedScopes()).toEqual([]);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    component.toggleScope('activity-details:read', { checked: true } as never);
    expect(option()).toMatchObject({ selected: false, disabled: false });
  });

  it('requires an explicit unchecked-by-default selection even for a notes-only request', async () => {
    functions.call.mockResolvedValueOnce({ data: { requestId: 'notes-request', scopes: ['timeline-notes:read'],
      clientName: 'Notes client', redirectUri: 'https://client.example/callback' } });
    const fixture = TestBed.createComponent(McpAuthorizationComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.selectedScopes()).toEqual([]);
    expect(component.scopeOptions()[0]).toMatchObject({ title: 'Timeline notes', selected: false, disabled: false });
    expect(fixture.nativeElement.textContent).toContain('sensitive health or personal information');
    expect(fixture.nativeElement.textContent).toContain('cannot erase copies');
    expect(haptics.selection).not.toHaveBeenCalled();
    await component.approve();
    expect(functions.call).toHaveBeenCalledTimes(1);
    component.toggleScope('timeline-notes:read', { checked: true } as never);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    await component.approve();
    expect(functions.call).toHaveBeenLastCalledWith('decideMcpAuthorization', {
      requestId: 'notes-request', approved: true, grantedScopes: ['timeline-notes:read'],
    });
  });

  it('stacks the full-width authorization actions with the primary action first', async () => {
    const fixture = TestBed.createComponent(McpAuthorizationComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const actions = fixture.nativeElement.querySelector(
      '.mcp-authorization__actions',
    ) as HTMLElement;
    const buttons = Array.from(actions.querySelectorAll('button'));

    expect(actions).toBeTruthy();
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain('Allow selected access');
    expect(buttons[1].textContent).toContain('Deny');
  });

  it('submits the selected scopes and returns to the client', async () => {
    const fixture = TestBed.createComponent(McpAuthorizationComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.approve();

    expect(functions.call).toHaveBeenLastCalledWith('decideMcpAuthorization', {
      requestId: 'request-1',
      approved: true,
      grantedScopes: [
        'health:read',
        'metrics:read',
        'measurements:read',
        'sleep:read',
        'activity-details:read',
        'activity-location:read',
        'routes:read',
        'route-location:read',
      ],
    });
    expect(assign).toHaveBeenCalledWith('https://client.example/oauth/callback?code=code-1');
  });

  it('keeps Health opt-in independent and gives feedback only for an accepted selection change', async () => {
    const fixture = TestBed.createComponent(McpAuthorizationComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(haptics.selection).not.toHaveBeenCalled();
    const healthOption = fixture.componentInstance.scopeOptions().find(option => option.scope === 'health:read');
    expect(healthOption?.selected).toBe(true);
    fixture.componentInstance.toggleScope('health:read', { checked: false } as never);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.selectedScopes()).not.toContain('health:read');
    expect(fixture.componentInstance.selectedScopes()).toContain('measurements:read');
    fixture.componentInstance.toggleScope('health:read', { checked: false } as never);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('removes dependent location permissions with their parent scope', async () => {
    const fixture = TestBed.createComponent(McpAuthorizationComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.toggleScope(
      'activity-details:read',
      { checked: false } as never,
    );
    fixture.componentInstance.toggleScope(
      'routes:read',
      { checked: false } as never,
    );

    expect(fixture.componentInstance.selectedScopes()).not.toContain(
      'activity-location:read',
    );
    expect(fixture.componentInstance.selectedScopes()).not.toContain(
      'route-location:read',
    );
    const options = fixture.componentInstance.scopeOptions();
    expect(options.find(option => option.scope === 'activity-location:read')?.disabled)
      .toBe(true);
    expect(options.find(option => option.scope === 'route-location:read')?.disabled)
      .toBe(true);
  });

  it('omits granted scopes when denying so Firebase does not encode them as null', async () => {
    const fixture = TestBed.createComponent(McpAuthorizationComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.deny();

    expect(functions.call).toHaveBeenLastCalledWith('decideMcpAuthorization', {
      requestId: 'request-1',
      approved: false,
    });
  });
});
