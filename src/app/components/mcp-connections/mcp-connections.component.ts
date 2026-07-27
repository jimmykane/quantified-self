import { CommonModule } from '@angular/common';
import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppFunctionsService } from '../../services/app.functions.service';
import { AppWindowService } from '../../services/app.window.service';
import { LoggerService } from '../../services/logger.service';

interface McpConnection {
  connectionId: string;
  clientId: string;
  clientName: string;
  redirectHost: string;
  scopes: Array<
    | 'metrics:read'
    | 'measurements:read'
    | 'sleep:read'
    | 'activity-details:read'
    | 'activity-location:read'
    | 'routes:read'
    | 'route-location:read'
  >;
  createdAtMs: number;
  lastUsedAtMs: number | null;
}

@Component({
  selector: 'app-mcp-connections',
  standalone: true,
  imports: [
    CommonModule,
    ClipboardModule,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './mcp-connections.component.html',
  styleUrls: ['./mcp-connections.component.scss'],
})
export class McpConnectionsComponent implements OnInit {
  private readonly clipboard = inject(Clipboard);
  private readonly functions = inject(AppFunctionsService);
  private readonly logger = inject(LoggerService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly windowService = inject(AppWindowService);

  readonly connections = signal<McpConnection[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly revokingConnectionId = signal<string | null>(null);
  readonly scopeLabels: Record<McpConnection['scopes'][number], string> = {
    'metrics:read': 'Activity and Training metrics',
    'measurements:read': 'Body measurements',
    'sleep:read': 'Sleep summaries',
    'activity-details:read': 'Individual activity details',
    'activity-location:read': 'Activity locations',
    'routes:read': 'Saved-route summaries',
    'route-location:read': 'Saved-route locations and geometry',
  };
  readonly mcpEndpoint = `${this.windowService.currentDomain}/mcp`;

  ngOnInit(): void {
    void this.loadConnections();
  }

  async loadConnections(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.functions.call<
        undefined,
        { connections: McpConnection[] }
      >('listMcpConnections');
      this.connections.set(result.data.connections || []);
    } catch (error) {
      this.logger.error('[McpConnectionsComponent] Failed to list MCP connections', error);
      this.error.set('Could not load MCP connections.');
    } finally {
      this.loading.set(false);
    }
  }

  copyEndpoint(): void {
    if (this.clipboard.copy(this.mcpEndpoint)) {
      this.snackBar.open('MCP endpoint copied.', undefined, { duration: 4000 });
      return;
    }

    this.snackBar.open('Could not copy the MCP endpoint. Please copy it manually.', undefined, { duration: 5000 });
  }

  async revoke(connection: McpConnection): Promise<void> {
    if (this.revokingConnectionId()) {
      return;
    }

    this.revokingConnectionId.set(connection.connectionId);
    try {
      await this.functions.call('revokeMcpConnection', {
        connectionId: connection.connectionId,
      });
      this.connections.update(connections =>
        connections.filter(current => current.connectionId !== connection.connectionId));
      this.snackBar.open(`${connection.clientName} was disconnected.`, undefined, { duration: 4000 });
    } catch (error) {
      this.logger.error('[McpConnectionsComponent] Failed to revoke MCP connection', error);
      this.snackBar.open('Could not disconnect this MCP client. Please try again.', undefined, { duration: 5000 });
    } finally {
      this.revokingConnectionId.set(null);
    }
  }
}
