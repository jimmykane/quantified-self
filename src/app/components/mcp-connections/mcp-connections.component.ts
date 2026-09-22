import { CommonModule } from '@angular/common';
import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { Component, OnInit, TemplateRef, computed, inject, signal } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AppHapticsService } from '../../services/app.haptics.service';
import { MCP_SCOPE_CONTENT, MCP_SCOPE_PARENTS, type McpScope } from '../../helpers/mcp-permissions.helper';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppFunctionsService } from '../../services/app.functions.service';
import { AppWindowService } from '../../services/app.window.service';
import { LoggerService } from '../../services/logger.service';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';

const MCP_SCOPE_ENTRIES = Object.entries(MCP_SCOPE_CONTENT) as Array<[
  McpScope,
  typeof MCP_SCOPE_CONTENT[McpScope],
]>;
const CHANGE_SCOPES = new Set<McpScope>([
  'training-plans:write',
  'training-delivery:write',
  'timeline-notes:write',
  'activity-tags:write',
]);

interface McpConnection {
  connectionId: string;
  clientId: string;
  clientName: string;
  redirectHost: string;
  scopes: McpScope[];
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
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    CompactRowComponent,
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
  private readonly dialog = inject(MatDialog);
  readonly haptics = inject(AppHapticsService);

  readonly connections = signal<McpConnection[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly revokingConnectionId = signal<string | null>(null);
  readonly mcpEndpoint = `${this.windowService.currentDomain}/mcp`;
  readonly permissionInfo = Object.entries(MCP_SCOPE_CONTENT).map(([scope, content]) => ({
    scope,
    ...content,
    parentTitle: MCP_SCOPE_PARENTS[scope as McpScope]
      ? MCP_SCOPE_CONTENT[MCP_SCOPE_PARENTS[scope as McpScope]!].title : null,
  }));

  showPermissionInfo(permission: typeof this.permissionInfo[number], template: TemplateRef<unknown>): void {
    this.haptics.selection();
    this.dialog.open(template, { data: permission, width: '480px', maxWidth: 'calc(100vw - 32px)' });
  }
  readonly connectionDetails = computed(() => this.connections().map(connection => {
    const granted = new Set(connection.scopes);
    const permissions = MCP_SCOPE_ENTRIES.map(([scope, content]) => ({
      scope,
      title: content.title,
      granted: granted.has(scope),
      parentTitle: MCP_SCOPE_PARENTS[scope]
        ? MCP_SCOPE_CONTENT[MCP_SCOPE_PARENTS[scope]!].title : null,
      summary: MCP_SCOPE_PARENTS[scope]
        ? `Requires ${MCP_SCOPE_CONTENT[MCP_SCOPE_PARENTS[scope]!].title}.` : null,
    }));
    return {
      ...connection,
      permissions,
      permissionGroups: [
        {
          id: 'data',
          title: 'Data access',
          summary: 'Read permissions, including Training plans and planned workouts.',
          permissions: permissions.filter(permission => !CHANGE_SCOPES.has(permission.scope)),
        },
        {
          id: 'changes',
          title: 'Changes',
          summary: 'Optional changes use your client\'s native approval. Training changes also require a reviewed proposal.',
          permissions: permissions.filter(permission => CHANGE_SCOPES.has(permission.scope)),
        },
      ],
    };
  }));

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
        connections.filter(current => current.clientId !== connection.clientId));
      this.snackBar.open(`${connection.clientName} was disconnected.`, undefined, { duration: 4000 });
    } catch (error) {
      this.logger.error('[McpConnectionsComponent] Failed to revoke MCP connection', error);
      this.snackBar.open('Could not disconnect this MCP client. Please try again.', undefined, { duration: 5000 });
    } finally {
      this.revokingConnectionId.set(null);
    }
  }
}
