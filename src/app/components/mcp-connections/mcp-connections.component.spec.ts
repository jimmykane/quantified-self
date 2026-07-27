import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Clipboard } from '@angular/cdk/clipboard';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFunctionsService } from '../../services/app.functions.service';
import { AppWindowService } from '../../services/app.window.service';
import { LoggerService } from '../../services/logger.service';
import { McpConnectionsComponent } from './mcp-connections.component';

describe('McpConnectionsComponent', () => {
  const connection = {
    connectionId: 'connection-1',
    clientId: 'https://client.example/metadata.json',
    clientName: 'Training Copilot',
    redirectHost: 'client.example',
    scopes: [
      'metrics:read',
      'sleep:read',
      'activity-details:read',
      'routes:read',
    ] as Array<
      | 'metrics:read'
      | 'sleep:read'
      | 'activity-details:read'
      | 'routes:read'
    >,
    createdAtMs: 1_700_000_000_000,
    lastUsedAtMs: 1_700_001_000_000,
  };
  const clipboard = { copy: vi.fn(() => true) };
  const functions = {
    call: vi.fn(),
  };
  const snackBar = { open: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    functions.call.mockImplementation((name: string) => {
      if (name === 'listMcpConnections') {
        return Promise.resolve({ data: { connections: [connection] } });
      }
      return Promise.resolve({ data: { revoked: true } });
    });

    await TestBed.configureTestingModule({
      imports: [McpConnectionsComponent, NoopAnimationsModule],
      providers: [
        { provide: AppFunctionsService, useValue: functions },
        { provide: AppWindowService, useValue: { currentDomain: 'https://quantified-self.io' } },
        { provide: Clipboard, useValue: clipboard },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    }).compileComponents();
  });

  it('lists the client and its granted scopes', async () => {
    const fixture = TestBed.createComponent(McpConnectionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const content = fixture.nativeElement.textContent as string;
    expect(content).toContain('Training Copilot');
    expect(content).toContain('Activity, body measurements, and Training metrics');
    expect(content).toContain('Sleep summaries');
    expect(content).toContain('Individual activity details');
    expect(content).toContain('Saved routes and waypoints');
  });

  it('uses a standard glass-card stack matching the connection workspace', async () => {
    const fixture = TestBed.createComponent(McpConnectionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const cards = Array.from(
      fixture.nativeElement.querySelectorAll<HTMLElement>('mat-card.mcp-connections__card'),
    );
    const titles = cards.map(card =>
      card.querySelector('mat-card-title')?.textContent?.trim());

    expect(cards).toHaveLength(3);
    expect(titles).toEqual([
      'MCP connections',
      'ChatGPT setup',
      'Authorization and data access',
    ]);
    expect(cards.every(card => !card.classList.contains('qs-card-plain'))).toBe(true);
    expect(fixture.nativeElement.querySelector('.mcp-connections').tagName.toLowerCase())
      .toBe('section');
    expect(
      fixture.nativeElement.querySelector('.mcp-connections__section-header h2').textContent.trim(),
    ).toBe('Let’s help you set up your MCP plugin');
    const setupCard = cards[1];
    expect(setupCard.querySelector('code')?.textContent?.trim()).toBe('https://quantified-self.io/mcp');
    expect(setupCard.querySelector('.mcp-connections__app-icon')).toBeTruthy();
    expect(setupCard.querySelector('#mcp-android-guidance-title')).toBeTruthy();
  });

  it('shows the ChatGPT setup steps and copies the public endpoint', async () => {
    const fixture = TestBed.createComponent(McpConnectionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const content = fixture.nativeElement.textContent as string;
    expect(content).toContain('ChatGPT setup');
    expect(content).toContain('https://quantified-self.io/mcp');
    expect(content).toContain('Copy endpoint');
    expect(content).toContain('exact start, end, and jump coordinates');
    expect(content).toContain('reveal sensitive locations');
    expect(content).toContain('ChatGPT app icon');
    expect(content).toContain('Download 96 px · 3.3 KB');
    expect(content).toContain('Download 192 px · 9.9 KB');
    expect(content).toContain('client from the MCP connections card at any time');
    expect(content).toContain('only after it finishes authorization');
    expect(content).toContain('abandoned attempts expire automatically');
    expect(content).toContain('Authorizing on Android');
    expect(content).toContain('Desktop setup is the most reliable option');
    expect(content).toContain('Open supported links');
    expect(content).toContain('no active connection is created');
    expect(content).toContain('Authorization and data access');
    expect(content).toContain('any combination of these access categories');
    expect(content).toContain('metrics and body measurements');

    const iconDownloads = fixture.nativeElement.querySelectorAll<HTMLAnchorElement>(
      '.mcp-connections__icon-actions a',
    );
    expect(iconDownloads).toHaveLength(2);
    expect(iconDownloads[0].getAttribute('href'))
      .toBe('/assets/favicons/android-chrome-96x96.png');
    expect(iconDownloads[0].getAttribute('download'))
      .toBe('quantified-self-chatgpt-icon-96.png');
    expect(iconDownloads[1].getAttribute('href'))
      .toBe('/assets/favicons/android-chrome-192x192.png');
    expect(iconDownloads[1].getAttribute('download'))
      .toBe('quantified-self-chatgpt-icon-192.png');

    fixture.componentInstance.copyEndpoint();

    expect(clipboard.copy).toHaveBeenCalledWith('https://quantified-self.io/mcp');
    expect(snackBar.open).toHaveBeenCalledWith(
      'MCP endpoint copied.',
      undefined,
      { duration: 4000 },
    );
  });

  it('revokes a connection and removes it from the list', async () => {
    const fixture = TestBed.createComponent(McpConnectionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.revoke(connection);

    expect(functions.call).toHaveBeenCalledWith('revokeMcpConnection', {
      connectionId: 'connection-1',
    });
    expect(fixture.componentInstance.connections()).toEqual([]);
    expect(snackBar.open).toHaveBeenCalledWith(
      'Training Copilot was disconnected.',
      undefined,
      { duration: 4000 },
    );
  });
});
