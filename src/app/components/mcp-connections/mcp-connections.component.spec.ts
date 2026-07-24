import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFunctionsService } from '../../services/app.functions.service';
import { LoggerService } from '../../services/logger.service';
import { McpConnectionsComponent } from './mcp-connections.component';

describe('McpConnectionsComponent', () => {
  const connection = {
    connectionId: 'connection-1',
    clientId: 'https://client.example/metadata.json',
    clientName: 'Training Copilot',
    redirectHost: 'client.example',
    scopes: ['metrics:read', 'sleep:read'] as Array<'metrics:read' | 'sleep:read'>,
    createdAtMs: 1_700_000_000_000,
    lastUsedAtMs: 1_700_001_000_000,
  };
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
    expect(content).toContain('Activity and Training metrics');
    expect(content).toContain('Sleep summaries');
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
