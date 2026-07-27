import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFunctionsService } from '../../services/app.functions.service';
import { AppWindowService } from '../../services/app.window.service';
import { LoggerService } from '../../services/logger.service';
import { McpAuthorizationComponent } from './mcp-authorization.component';

describe('McpAuthorizationComponent', () => {
  const assign = vi.fn();
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
              'metrics:read',
              'measurements:read',
              'sleep:read',
              'activity-details:read',
              'routes:read',
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
    expect(content).toContain('Read bounded identity-free body-measurement history such as weight');
    expect(content).toContain('exact source timestamps');
    expect(content).toContain('selected canonical numeric metrics for one activity');
    expect(content).toContain('Sleep summaries');
    expect(content).toContain('Individual activity details');
    expect(content).toContain('exact start and end coordinates when available');
    expect(content).toContain('search starts or ends near a location');
    expect(content).toContain('MTB jumps with exact coordinates');
    expect(content).toContain('home, workplace, frequent trailhead');
    expect(content).toContain('Saved routes and waypoints');
    expect(content).toContain('preview geometry with segment endpoints');
    expect(content).toContain('waypoint coordinates');
    expect(content).toContain('location text to Mapbox');
    expect(content).toContain('direct-coordinate searches stay within Quantified Self');
    expect(content).toContain('Raw streams');
    expect(content).toContain('precise-position metrics');
    expect(content).toContain('unrequested activity stats');
    expect(content).toContain('stable account/event or route paths');
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
        'metrics:read',
        'measurements:read',
        'sleep:read',
        'activity-details:read',
        'routes:read',
      ],
    });
    expect(assign).toHaveBeenCalledWith('https://client.example/oauth/callback?code=code-1');
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
