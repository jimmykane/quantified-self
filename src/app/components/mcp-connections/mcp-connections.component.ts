import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppFunctionsService } from '../../services/app.functions.service';
import { LoggerService } from '../../services/logger.service';

interface McpConnection {
  connectionId: string;
  clientId: string;
  clientName: string;
  redirectHost: string;
  scopes: Array<'metrics:read' | 'sleep:read'>;
  createdAtMs: number;
  lastUsedAtMs: number | null;
}

@Component({
  selector: 'app-mcp-connections',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './mcp-connections.component.html',
  styleUrls: ['./mcp-connections.component.scss'],
})
export class McpConnectionsComponent implements OnInit {
  private readonly functions = inject(AppFunctionsService);
  private readonly logger = inject(LoggerService);
  private readonly snackBar = inject(MatSnackBar);

  readonly connections = signal<McpConnection[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly revokingConnectionId = signal<string | null>(null);
  readonly scopeLabels: Record<McpConnection['scopes'][number], string> = {
    'metrics:read': 'Activity and Training metrics',
    'sleep:read': 'Sleep summaries',
  };

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
