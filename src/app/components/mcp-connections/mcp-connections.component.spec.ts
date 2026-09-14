import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Clipboard } from '@angular/cdk/clipboard';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFunctionsService } from '../../services/app.functions.service';
import { AppWindowService } from '../../services/app.window.service';
import { LoggerService } from '../../services/logger.service';
import { McpConnectionsComponent } from './mcp-connections.component';
import { AppHapticsService } from '../../services/app.haptics.service';
import { MatDialog } from '@angular/material/dialog';
import { MCP_SCOPE_CONTENT } from '../../helpers/mcp-permissions.helper';

describe('McpConnectionsComponent', () => {
  const connection = {
    connectionId: 'connection-1',
    clientId: 'https://client.example/metadata.json',
    clientName: 'Training Copilot',
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
    ] as Array<
      | 'health:read'
      | 'metrics:read'
      | 'measurements:read'
      | 'sleep:read'
      | 'activity-details:read'
      | 'activity-location:read'
      | 'routes:read'
      | 'route-location:read'
    >,
    createdAtMs: 1_700_000_000_000,
    lastUsedAtMs: 1_700_001_000_000,
  };
  const clipboard = { copy: vi.fn(() => true) };
  const functions = {
    call: vi.fn(),
  };
  const snackBar = { open: vi.fn() };
  const haptics = { selection: vi.fn() };

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
        { provide: AppHapticsService, useValue: haptics },
      ],
    }).compileComponents();
  });

  it('lists all permissions and distinguishes granted from not granted without allowing changes', async () => {
    const fixture = TestBed.createComponent(McpConnectionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const content = fixture.nativeElement.textContent as string;
    expect(content).toContain('Training Copilot');
    expect(content).toContain('Activity and Training metrics');
    expect(content).toContain('Body measurements');
    expect(content).toContain('Health metrics');
    expect(content).toContain('Sleep summaries');
    expect(content).toContain('Individual activity details');
    expect(content).toContain('Activity locations');
    expect(content).toContain('Saved-route summaries');
    expect(content).toContain('Saved-route locations and geometry');
    expect(content).toContain('These apps can only view the data you approved');
    expect(content).toContain('Disconnect an app here to stop sharing');
    expect(content).toContain('Reconnecting the same app keeps the current connection active');

    const permissionInputs = Array.from(
      fixture.nativeElement.querySelectorAll<HTMLInputElement>(
        '.mcp-connections__permissions input[type="checkbox"]',
      ),
    );
    expect(permissionInputs).toHaveLength(Object.keys(fixture.componentInstance.scopeLabels).length);
    expect(permissionInputs.filter(input => input.checked)).toHaveLength(connection.scopes.length);
    expect(permissionInputs.every(input => input.disabled)).toBe(true);
    const rows = Array.from(fixture.nativeElement.querySelectorAll<HTMLElement>(
      '.mcp-connections__permissions mat-checkbox',
    ));
    for (const label of ['Timeline notes', 'Activity descriptions']) {
      const row = rows.find(row => row.textContent?.includes(label))!;
      expect(row.textContent.trim()).toBe(label);
      expect(row.querySelector('input')?.checked).toBe(false);
    }
    expect(rows.find(row => row.textContent?.includes('Health metrics'))?.textContent.trim()).toBe('Health metrics');
    expect(content).toContain('Reconnect this app to approve unchecked permissions.');
    expect(functions.call).toHaveBeenCalledTimes(1);
  });

  it('recomputes each connection independently when grants change', async () => {
    const fixture = TestBed.createComponent(McpConnectionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.connections.set([
      { ...connection, scopes: ['metrics:read'] },
      { ...connection, connectionId: 'connection-2', scopes: ['sleep:read'] },
    ]);
    fixture.detectChanges();
    const rows = fixture.componentInstance.connectionDetails();
    expect(rows[0].permissions.filter(permission => permission.granted).map(permission => permission.scope))
      .toEqual(['metrics:read']);
    expect(rows[1].permissions.filter(permission => permission.granted).map(permission => permission.scope))
      .toEqual(['sleep:read']);
    expect(functions.call).toHaveBeenCalledTimes(1);
  });

  it('shows concise permission rows and opens the matching details with selection feedback', async () => {
    const fixture = TestBed.createComponent(McpConnectionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('[aria-labelledby="mcp-authorization-title"]');
    const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons).toHaveLength(Object.keys(MCP_SCOPE_CONTENT).length);
    expect(card.textContent).not.toContain('Text may include sensitive health');
    expect(card.textContent).toContain('Reconnect an app to grant additional permissions');
    expect(haptics.selection).not.toHaveBeenCalled();
    for (const permission of fixture.componentInstance.permissionInfo) {
      buttons.find(button => button.getAttribute('aria-label') === `About ${permission.title}`)!.click();
      await fixture.whenStable();
      fixture.detectChanges();
      const dialog = document.querySelector('mat-dialog-container')!;
      expect(dialog.textContent).toContain(permission.description);
      if (permission.parentTitle) expect(dialog.textContent).toContain(`Requires ${permission.parentTitle} permission`);
      expect(dialog.textContent).toContain('Reconnect the app and approve this permission');
      (dialog.querySelector('button') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();
    }
    expect(haptics.selection).toHaveBeenCalledTimes(buttons.length * 2);
    expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(0);
    expect(functions.call).toHaveBeenCalledTimes(1);
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
    expect(content).toContain('ChatGPT app icon');
    expect(content).toContain('recommended size');
    expect(content).toContain('under its 10 KB limit');
    expect(content).toContain('Download recommended icon · 256 px · 9.4 KB');
    expect(content).toContain('Authorizing on Android');
    expect(content).toContain('Desktop setup is the most reliable option');
    expect(content).toContain('Open supported links');
    expect(content).toContain('no active connection is created');
    expect(content).toContain('Authorization and data access');
    expect(content).toContain('metrics, body measurements');

    const iconDownloads = fixture.nativeElement.querySelectorAll<HTMLAnchorElement>(
      '.mcp-connections__icon-actions a',
    );
    expect(iconDownloads).toHaveLength(1);
    expect(iconDownloads[0].getAttribute('href'))
      .toBe('/assets/favicons/quantified-self-chatgpt-icon-256x256.png');
    expect(iconDownloads[0].getAttribute('download'))
      .toBe('quantified-self-chatgpt-icon-256x256.png');

    const iconAsset = readFileSync(resolve(
      process.cwd(),
      'src/assets/favicons/quantified-self-chatgpt-icon-256x256.png',
    ));
    expect(iconAsset.readUInt32BE(16)).toBe(256);
    expect(iconAsset.readUInt32BE(20)).toBe(256);
    expect(iconAsset.byteLength).toBeLessThanOrEqual(10_000);

    fixture.componentInstance.copyEndpoint();

    expect(clipboard.copy).toHaveBeenCalledWith('https://quantified-self.io/mcp');
    expect(snackBar.open).toHaveBeenCalledWith(
      'MCP endpoint copied.',
      undefined,
      { duration: 4000 },
    );
  });

  it('revokes a logical client and removes any duplicate rows for that client', async () => {
    const fixture = TestBed.createComponent(McpConnectionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const otherConnection = {
      ...connection,
      connectionId: 'other-connection',
      clientId: 'https://other.example/metadata.json',
      clientName: 'Other Client',
    };
    fixture.componentInstance.connections.set([
      connection,
      {
        ...connection,
        connectionId: 'legacy-duplicate',
      },
      otherConnection,
    ]);

    await fixture.componentInstance.revoke(connection);

    expect(functions.call).toHaveBeenCalledWith('revokeMcpConnection', {
      connectionId: 'connection-1',
    });
    expect(fixture.componentInstance.connections()).toEqual([otherConnection]);
    expect(snackBar.open).toHaveBeenCalledWith(
      'Training Copilot was disconnected.',
      undefined,
      { duration: 4000 },
    );
  });
});
