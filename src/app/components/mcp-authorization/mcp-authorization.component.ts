import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AppFunctionsService } from '../../services/app.functions.service';
import { AppWindowService } from '../../services/app.window.service';
import { LoggerService } from '../../services/logger.service';

type McpScope =
  | 'metrics:read'
  | 'measurements:read'
  | 'sleep:read'
  | 'activity-details:read'
  | 'activity-location:read'
  | 'routes:read'
  | 'route-location:read';

const MCP_SCOPE_PARENTS: Partial<Record<McpScope, McpScope>> = {
  'activity-location:read': 'activity-details:read',
  'route-location:read': 'routes:read',
};

const MCP_SCOPE_CHILDREN: Partial<Record<McpScope, McpScope>> = {
  'activity-details:read': 'activity-location:read',
  'routes:read': 'route-location:read',
};

const MCP_SCOPE_CONTENT: Record<McpScope, {
  title: string;
  description: string;
}> = {
  'metrics:read': {
    title: 'Activity and Training metrics',
    description: 'Read persisted numeric activity metrics and redacted Training-derived snapshots. When individual activity access is also granted, the client can request selected canonical numeric metrics for one activity.',
  },
  'measurements:read': {
    title: 'Body measurements',
    description: 'Read bounded identity-free body-measurement history such as weight. Values are grouped by day, week, or month; exact source timestamps, event or activity identity, provider, device, and source details are excluded.',
  },
  'sleep:read': {
    title: 'Sleep summaries',
    description: 'Read redacted sleep sessions and aggregated summaries, including bounded discovery of available aggregate HRV, heart-rate, blood-oxygen, and respiration values. Raw sensor samples and provider payloads are excluded.',
  },
  'activity-details:read': {
    title: 'Individual activity details',
    description: 'Read non-location activity summaries, laps, swim lengths, MTB jump measurements, selected activity metrics, and bounded on-demand chart series from existing original files. Exact locations and breadcrumb traces require the separate activity-location permission.',
  },
  'activity-location:read': {
    title: 'Activity locations',
    description: 'Read exact activity start, end, MTB jump, and bounded breadcrumb coordinates, and search activity starts or ends near a place. Place-name searches send the location text to Mapbox.',
  },
  'routes:read': {
    title: 'Saved-route summaries',
    description: 'Read route names, activity types, metric summaries, route, waypoint, and point counts, import/update times, and signed-in application links. Exact route locations require the separate saved-route location permission.',
  },
  'route-location:read': {
    title: 'Saved-route locations and geometry',
    description: 'Read exact route bounds, preview geometry and segment endpoints, waypoint coordinates, altitude and distance, and search routes near a place. Place-name searches send the location text to Mapbox.',
  },
};

interface McpAuthorizationRequest {
  requestId: string;
  clientName: string;
  clientIdHost: string;
  redirectUri: string;
  redirectHost: string;
  scopes: McpScope[];
  expiresAtMs: number;
  loopbackRedirect: boolean;
}

@Component({
  selector: 'app-mcp-authorization',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './mcp-authorization.component.html',
  styleUrls: ['./mcp-authorization.component.scss'],
})
export class McpAuthorizationComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly functions = inject(AppFunctionsService);
  private readonly windowService = inject(AppWindowService);
  private readonly logger = inject(LoggerService);

  readonly request = signal<McpAuthorizationRequest | null>(null);
  readonly loading = signal(true);
  readonly deciding = signal<'approve' | 'deny' | null>(null);
  readonly error = signal<string | null>(null);
  readonly selectedScopes = signal<McpScope[]>([]);
  readonly isAndroid = /android/i.test(
    this.windowService.windowRef.navigator?.userAgent || '',
  );
  readonly scopeOptions = computed(() => {
    const selected = new Set(this.selectedScopes());
    return (this.request()?.scopes || []).map(scope => ({
      scope,
      selected: selected.has(scope),
      disabled: this.deciding() !== null
        || Boolean(MCP_SCOPE_PARENTS[scope] && !selected.has(MCP_SCOPE_PARENTS[scope]!)),
      ...MCP_SCOPE_CONTENT[scope],
    }));
  });

  async ngOnInit(): Promise<void> {
    const requestId = `${this.route.snapshot.queryParamMap.get('request_id') || ''}`.trim();
    if (!requestId) {
      this.error.set('This authorization request is missing or invalid.');
      this.loading.set(false);
      return;
    }

    try {
      const result = await this.functions.call<
        { requestId: string },
        McpAuthorizationRequest
      >('getMcpAuthorizationRequest', { requestId });
      this.request.set(result.data);
      this.selectedScopes.set([...result.data.scopes]);
    } catch (error) {
      this.logger.error('[McpAuthorizationComponent] Failed to load authorization request', error);
      this.error.set('This authorization request is invalid, expired, or no longer available.');
    } finally {
      this.loading.set(false);
    }
  }

  toggleScope(scope: McpScope, event: MatCheckboxChange): void {
    this.selectedScopes.update((scopes) => {
      if (event.checked) {
        const parent = MCP_SCOPE_PARENTS[scope];
        return parent && !scopes.includes(parent)
          ? scopes
          : [...new Set([...scopes, scope])];
      }
      const child = MCP_SCOPE_CHILDREN[scope];
      return scopes.filter(current => current !== scope && current !== child);
    });
  }

  approve(): Promise<void> {
    return this.decide(true);
  }

  deny(): Promise<void> {
    return this.decide(false);
  }

  private async decide(approved: boolean): Promise<void> {
    const request = this.request();
    if (!request || this.deciding()) {
      return;
    }
    if (approved && this.selectedScopes().length === 0) {
      this.error.set('Select at least one permission or deny the request.');
      return;
    }

    this.deciding.set(approved ? 'approve' : 'deny');
    this.error.set(null);
    try {
      const decision = {
        requestId: request.requestId,
        approved,
        ...(approved ? { grantedScopes: this.selectedScopes() } : {}),
      };
      const result = await this.functions.call<
        { requestId: string; approved: boolean; grantedScopes?: McpScope[] },
        { redirectUri: string }
      >('decideMcpAuthorization', decision);
      this.windowService.windowRef.location.assign(result.data.redirectUri);
    } catch (error) {
      this.logger.error('[McpAuthorizationComponent] Failed to decide authorization request', error);
      this.error.set('Could not complete this authorization request. Please return to the client and try again.');
      this.deciding.set(null);
    }
  }
}
