import { AddressInfo } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';
import { McpDataError } from './data.service';
import {
  McpBearerAuthenticationError,
  McpOAuthError,
  MCP_OAUTH_SCOPES,
  type McpOAuthScope,
  rejectRepeatedOAuthParameters,
} from './oauth.service';
import {
  ASSISTANT_PERMISSION_RECOVERY_INSTRUCTIONS,
  buildMcpAuthorizationServerMetadata,
  buildMcpProtectedResourceMetadata,
  classifyMcpBearerRejectionReason,
  classifyMcpBearerFailure,
  classifyMcpDiagnosticClientFamily,
  classifyMcpTransportRejectionReason,
  createMcpServer,
  formatMcpToolError,
  handleMcpRevocationRequest,
  isMcpFormUrlEncodedContentType,
  isMcpRequestBodyWithinLimit,
  mcpToolRequestBodyLimit,
  MCP_API_RUNTIME_OPTIONS,
  MCP_PERMISSION_RECOVERY_INSTRUCTIONS,
  parseMcpBearerToken,
  parseMcpDateTime,
  parseMcpFormEncodedBody,
  requiredScopesForRequest,
  resolveMcpAuthorizationRequesterKey,
  resolvePublicBaseUrl,
  requireMcpTokenGrantType,
  sanitizeMcpProtocolVersionForDiagnostics,
  summarizeMcpOutputValidationIssues,
  supportsMcpTransportMethod,
} from './server';
import { createMcpTransportHandler } from './transport';

describe('MCP HTTP scope enforcement', () => {
  it('prepares only caller-owned selected Training kinds with non-destructive idempotent metadata', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const calls: Array<{ uid: string; kinds: string[] }> = [];
    const server = createMcpServer({
      uid: 'user-1', clientId: 'https://client.example/mcp.json', connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
    }, 'https://quantified-self.io', undefined, async (uid, metricKinds) => {
      calls.push({ uid, kinds: metricKinds });
      return { status: 'preparing', metricKinds, readyMetricKinds: [], retryAfterSeconds: 5 };
    });
    const client = new Client({ name: 'preparation-test-client', version: '1.0.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tool = (await client.listTools()).tools.find(item => item.name === 'prepare_training_metrics');
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false,
      });
      const result = await client.callTool({ name: 'prepare_training_metrics', arguments: {
        metricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.Form],
      } });
      expect(result.structuredContent).toEqual({
        status: 'preparing', metricKinds: [DERIVED_METRIC_KINDS.Form],
        readyMetricKinds: [], retryAfterSeconds: 5,
      });
      expect(calls).toEqual([{ uid: 'user-1', kinds: [DERIVED_METRIC_KINDS.Form] }]);
      const invalid = await client.callTool({ name: 'prepare_training_metrics', arguments: {
        metricKinds: ['unknown'], uid: 'user-2',
      } });
      expect(invalid.isError).toBe(true);
      expect(calls).toHaveLength(1);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('advertises actionable permission recovery without treating missing tools as missing data', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [],
    }, 'https://quantified-self.io');
    const client = new Client({ name: 'permission-recovery-client', version: '1.0.0' });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const instructions = client.getInstructions() || '';
      expect(instructions).toContain(MCP_PERMISSION_RECOVERY_INSTRUCTIONS);
      expect(instructions).toContain('choose Reconnect or start authorization again');
      expect(instructions).toContain('start a new chat or refresh the client tools');
      expect(instructions).toContain('Uninstall and reinstall is a last resort');
      expect(instructions).toContain('do not interpret that as missing user data');
      expect(instructions).toContain('or tell the user to reconnect a Garmin');
      expect(instructions).not.toContain('disconnect and reinstall Quantified Self');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('routes built-in Assistant permission recovery to its own data-access controls', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'first-party-assistant-v1',
      connectionId: 'first-party-assistant-v1:conversation-1',
      assistantConversationId: 'conversation-1',
      scopes: [],
    }, 'https://quantified-self.io');
    const client = new Client({ name: 'assistant-permission-recovery-client', version: '1.0.0' });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const instructions = client.getInstructions() || '';
      expect(instructions).toContain(ASSISTANT_PERMISSION_RECOVERY_INSTRUCTIONS);
      expect(instructions).toContain('open Examples & data access');
      expect(instructions).toContain('fresh chat that Quantified Self starts');
      expect(instructions).not.toContain('choose Reconnect or start authorization again');
      expect(instructions).not.toContain('Uninstall and reinstall');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('requires Health and Sleep before serving shared HRV ranges', () => {
    expect(requiredScopesForRequest({ method: 'tools/call', params: { name: 'get_hrv_personal_range' } }))
      .toEqual([MCP_OAUTH_SCOPES.HealthRead, MCP_OAUTH_SCOPES.SleepRead]);
  });
  it('bounds per-instance concurrency for memory-intensive chart requests', () => {
    expect(MCP_API_RUNTIME_OPTIONS).toMatchObject({
      region: 'europe-west2',
      memory: '1GiB',
      timeoutSeconds: 120,
      concurrency: 4,
    });
  });

  function buildRevocationHttpHarness(input?: {
    body?: unknown;
    contentType?: string;
    contentLength?: string;
    forwardedFor?: string;
  }) {
    const headers = new Map<string, string>();
    const json = vi.fn();
    const send = vi.fn();
    let statusCode: number | null = null;
    const response = {
      set: vi.fn((name: string, value: string) => {
        headers.set(name, value);
      }),
      status: vi.fn((value: number) => {
        statusCode = value;
        return { json, send };
      }),
    };
    const request = {
      body: input?.body ?? '',
      ip: '198.51.100.20',
      get: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === 'content-type') {
          return input?.contentType ?? 'application/x-www-form-urlencoded';
        }
        if (normalized === 'content-length') {
          return input?.contentLength;
        }
        if (normalized === 'x-forwarded-for') {
          return input?.forwardedFor;
        }
        return undefined;
      },
    } as Parameters<typeof handleMcpRevocationRequest>[0];
    return {
      request,
      response: response as Parameters<typeof handleMcpRevocationRequest>[1],
      headers,
      json,
      send,
      statusCode: () => statusCode,
    };
  }

  it('advertises public and RS256 private CIMD token authentication with public revocation', () => {
    expect(buildMcpAuthorizationServerMetadata('https://quantified-self.io'))
      .toEqual(expect.objectContaining({
        issuer: 'https://quantified-self.io',
        token_endpoint: 'https://quantified-self.io/oauth/token',
        revocation_endpoint: 'https://quantified-self.io/oauth/revoke',
        token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
        token_endpoint_auth_signing_alg_values_supported: ['RS256'],
        revocation_endpoint_auth_methods_supported: ['none'],
      }));
  });

  it('builds protected-resource metadata from the same public origin', () => {
    expect(buildMcpProtectedResourceMetadata('https://quantified-self.io'))
      .toEqual({
        resource: 'https://quantified-self.io/mcp',
        resource_name: 'Quantified Self MCP',
        authorization_servers: ['https://quantified-self.io'],
        scopes_supported: Object.values(MCP_OAUTH_SCOPES),
        bearer_methods_supported: ['header'],
      });
  });

  it('accepts a form-encoded server-to-server revocation request with an empty 200 response', async () => {
    const clientId = 'https://client.example/mcp.json';
    const harness = buildRevocationHttpHarness({
      body: new URLSearchParams({
        token: 'opaque-token',
        token_type_hint: 'refresh_token',
        client_id: clientId,
      }).toString(),
      forwardedFor: '203.0.113.10, 10.0.0.1',
    });
    const revokeToken = vi.fn().mockResolvedValue(undefined);

    await handleMcpRevocationRequest(
      harness.request,
      harness.response,
      { revokeToken },
    );

    expect(revokeToken).toHaveBeenCalledWith({
      token: 'opaque-token',
      token_type_hint: 'refresh_token',
      client_id: clientId,
    }, {
      requesterKey: '203.0.113.10',
    });
    expect(harness.statusCode()).toBe(200);
    expect(harness.send).toHaveBeenCalledWith('');
    expect(harness.json).not.toHaveBeenCalled();
    expect(harness.headers.get('Cache-Control')).toBe('no-store');
    expect(harness.headers.get('Pragma')).toBe('no-cache');
  });

  it('maps pre-auth revocation throttling to a bounded OAuth error response', async () => {
    const harness = buildRevocationHttpHarness({
      body: 'token=opaque-token&client_id=https%3A%2F%2Fclient.example%2Fmcp.json',
    });
    const revokeToken = vi.fn().mockRejectedValue(new McpOAuthError(
      'temporarily_unavailable',
      'The token revocation rate limit was exceeded.',
      429,
    ));

    await handleMcpRevocationRequest(
      harness.request,
      harness.response,
      { revokeToken },
    );

    expect(harness.statusCode()).toBe(429);
    expect(harness.headers.get('Retry-After')).toBe('60');
    expect(harness.json).toHaveBeenCalledWith({
      error: 'temporarily_unavailable',
      error_description: 'The token revocation rate limit was exceeded.',
    });
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('rejects non-form revocation bodies before calling the OAuth service', async () => {
    const harness = buildRevocationHttpHarness({
      body: { token: 'opaque-token' },
      contentType: 'application/json',
    });
    const revokeToken = vi.fn();

    await handleMcpRevocationRequest(
      harness.request,
      harness.response,
      { revokeToken },
    );

    expect(harness.statusCode()).toBe(400);
    expect(harness.json).toHaveBeenCalledWith({
      error: 'invalid_request',
      error_description: 'The revocation request must use application/x-www-form-urlencoded.',
    });
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it('uses only canonical allowlisted origins for OAuth issuer and audience URLs', () => {
    const requestWithHost = (host: string) => ({
      get: (name: string) => name.toLowerCase() === 'x-forwarded-host' ? host : undefined,
    }) as unknown as Parameters<typeof resolvePublicBaseUrl>[0];

    expect(resolvePublicBaseUrl(requestWithHost('beta.quantified-self.io')))
      .toBe('https://beta.quantified-self.io');
    expect(resolvePublicBaseUrl(requestWithHost('quantified-self.io:444')))
      .toBe('https://quantified-self.io');
    expect(resolvePublicBaseUrl(requestWithHost('attacker.example')))
      .toBe('https://quantified-self.io');
  });

  it('uses the Cloud Functions client address for public authorization rate limits', () => {
    const request = (
      forwardedFor: string | undefined,
      ip?: string,
    ) => ({
      get: (name: string) => name.toLowerCase() === 'x-forwarded-for'
        ? forwardedFor
        : undefined,
      ip,
    });

    expect(resolveMcpAuthorizationRequesterKey(
      request('203.0.113.10, 10.0.0.1', '10.0.0.2'),
    )).toBe('203.0.113.10');
    expect(resolveMcpAuthorizationRequesterKey(
      request('not-an-ip', '2001:db8::10'),
    )).toBe('2001:db8::10');
    expect(resolveMcpAuthorizationRequesterKey(
      request(undefined, undefined),
    )).toBe('unknown');
  });

  it('requires independent metrics and measurement scopes', () => {
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'query_metric' },
    })).toEqual([MCP_OAUTH_SCOPES.MetricsRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'query_metrics' },
    })).toEqual([MCP_OAUTH_SCOPES.MetricsRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'list_training_metrics' },
    })).toEqual([MCP_OAUTH_SCOPES.MetricsRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'query_measurements' },
    })).toEqual([MCP_OAUTH_SCOPES.MeasurementsRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'list_measurement_types' },
    })).toEqual([MCP_OAUTH_SCOPES.MeasurementsRead]);
  });

  it('authorizes detailed samples with the existing Activity details grant', () => {
    expect(requiredScopesForRequest({method: 'tools/call', params: {name: 'get_activity_samples'}}))
      .toEqual([MCP_OAUTH_SCOPES.ActivityDetailsRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'query_activities_with_tags' },
    })).toEqual([MCP_OAUTH_SCOPES.ActivityDetailsRead]);
  });

  it('requires both parent reads and explicit content-change scopes before dispatch', () => {
    expect(requiredScopesForRequest({ method: 'tools/call', params: {
      name: 'update_event_tags',
    } })).toEqual([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.EventsWrite,
    ]);
    for (const name of ['get_event_title', 'update_event_title']) {
      expect(requiredScopesForRequest({ method: 'tools/call', params: { name } })).toEqual([
        MCP_OAUTH_SCOPES.ActivityDetailsRead, MCP_OAUTH_SCOPES.EventsWrite,
      ]);
    }
    expect(requiredScopesForRequest({ method: 'tools/call', params: {
      name: 'update_event_description',
    } })).toEqual([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.EventsWrite,
      MCP_OAUTH_SCOPES.ActivityDescriptionsRead,
    ]);
    for (const name of [
      'query_editable_timeline_notes',
      'create_timeline_note',
      'update_timeline_note',
      'delete_timeline_note',
    ]) {
      expect(requiredScopesForRequest({ method: 'tools/call', params: { name } })).toEqual([
        MCP_OAUTH_SCOPES.TimelineNotesRead,
        MCP_OAUTH_SCOPES.TimelineNotesWrite,
      ]);
    }
  });

  it('registers content changes only when their separate write scopes are present', async () => {
    const list = async (scopes: McpOAuthScope[]) => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createMcpServer({
        uid: 'user-1', clientId: 'https://client.example/mcp.json',
        connectionId: 'connection-1', scopes,
      }, 'https://quantified-self.io');
      const client = new Client({ name: 'content-write-scope-client', version: '1.0.0' });
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        return (await client.listTools()).tools.map(tool => tool.name);
      } finally {
        await client.close();
        await server.close();
      }
    };
    const readOnly = await list([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.TimelineNotesRead,
    ]);
    expect(readOnly).not.toContain('update_event_tags');
    expect(readOnly).not.toContain('get_event_title');
    expect(readOnly).not.toContain('update_event_title');
    expect(readOnly).not.toContain('update_event_description');
    expect(readOnly).not.toContain('query_editable_timeline_notes');
    expect(readOnly).not.toContain('create_timeline_note');

    const writable = await list([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.EventsWrite,
      MCP_OAUTH_SCOPES.TimelineNotesRead,
      MCP_OAUTH_SCOPES.TimelineNotesWrite,
    ]);
    expect(writable).toEqual(expect.arrayContaining([
      'update_event_tags',
      'get_event_title',
      'update_event_title',
      'query_editable_timeline_notes',
      'create_timeline_note',
      'update_timeline_note',
      'delete_timeline_note',
    ]));
    expect(writable).not.toContain('update_event_description');
    const descriptionWritable = await list([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.EventsWrite,
      MCP_OAUTH_SCOPES.ActivityDescriptionsRead,
    ]);
    expect(descriptionWritable).toContain('update_event_description');
  });

  it('keeps first-party Assistant event access limited to its existing tag workflow', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1', clientId: 'first-party-assistant-v1',
      connectionId: 'first-party-assistant-v1:conversation-1',
      assistantConversationId: 'conversation-1',
      scopes: [MCP_OAUTH_SCOPES.ActivityDetailsRead, MCP_OAUTH_SCOPES.EventsWrite,
        MCP_OAUTH_SCOPES.ActivityDescriptionsRead],
    }, 'https://quantified-self.io');
    const client = new Client({ name: 'assistant-event-scope-client', version: '1.0.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const names = (await client.listTools()).tools.map(tool => tool.name);
      expect(names).toContain('update_event_tags');
      expect(names).not.toContain('get_event_title');
      expect(names).not.toContain('update_event_title');
      expect(names).not.toContain('update_event_description');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('requires sleep scope for sleep tools', () => {
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'get_sleep_trend' },
    })).toEqual([MCP_OAUTH_SCOPES.SleepRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'list_sleep_vitals' },
    })).toEqual([MCP_OAUTH_SCOPES.SleepRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'list_sleep_sessions' },
    })).toEqual([MCP_OAUTH_SCOPES.SleepRead]);
  });

  it('requires Health permission and additionally gates body composition before dispatch', () => {
    expect(requiredScopesForRequest({ method: 'tools/call', params: { name: 'list_health_metrics' } }))
      .toEqual([MCP_OAUTH_SCOPES.HealthRead]);
    expect(requiredScopesForRequest({ method: 'tools/call', params: {
      name: 'query_health_metric', arguments: { metricId: 'heart_rate' },
    } })).toEqual([MCP_OAUTH_SCOPES.HealthRead]);
    expect(requiredScopesForRequest({ method: 'tools/call', params: {
      name: 'query_health_metric', arguments: { metricId: 'body_fat' },
    } })).toEqual([MCP_OAUTH_SCOPES.HealthRead, MCP_OAUTH_SCOPES.MeasurementsRead]);
  });

  it('requires both metrics and sleep scopes for readiness and daily reports', () => {
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'get_today_readiness' },
    })).toEqual([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.SleepRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'get_daily_report' },
    })).toEqual([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.SleepRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'get_daily_briefing' },
    })).toEqual([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.SleepRead,
    ]);
  });

  it('derives independent Training read, schedule-write and delivery-write requirements from tool input', () => {
    expect(requiredScopesForRequest({ method: 'tools/call', params: {
      name: 'preview_create_planned_workout', arguments: { expectedScheduleRevision: 1 },
    } })).toEqual([MCP_OAUTH_SCOPES.TrainingPlansRead, MCP_OAUTH_SCOPES.TrainingPlansWrite]);
    expect(requiredScopesForRequest({ method: 'tools/call', params: {
      name: 'preview_create_planned_workout', arguments: {
        expectedScheduleRevision: 1,
        delivery: { providers: ['garmin'], timeZone: 'Europe/Helsinki' },
      },
    } })).toEqual([MCP_OAUTH_SCOPES.TrainingPlansRead, MCP_OAUTH_SCOPES.TrainingPlansWrite,
      MCP_OAUTH_SCOPES.TrainingDeliveryWrite]);
    expect(requiredScopesForRequest({ method: 'tools/call', params: {
      name: 'preview_strength_workout_change', arguments: { expectedScheduleRevision: 1 },
    } })).toEqual([MCP_OAUTH_SCOPES.TrainingPlansRead, MCP_OAUTH_SCOPES.TrainingPlansWrite]);
    expect(requiredScopesForRequest({ method: 'tools/call', params: {
      name: 'get_planned_workout_v2', arguments: { workoutRef: 'opaque' },
    } })).toEqual([MCP_OAUTH_SCOPES.TrainingPlansRead]);
    expect(requiredScopesForRequest({ method: 'tools/call', params: {
      name: 'preview_planned_workout_v2_change', arguments: { expectedScheduleRevision: 1 },
    } })).toEqual([MCP_OAUTH_SCOPES.TrainingPlansRead, MCP_OAUTH_SCOPES.TrainingPlansWrite]);
    expect(requiredScopesForRequest({ method: 'tools/call', params: { name: 'preview_training_changes', arguments: {
      expectedScheduleRevision: 1, changes: [{ kind: 'rename-plan' }],
    } } })).toEqual([MCP_OAUTH_SCOPES.TrainingPlansRead, MCP_OAUTH_SCOPES.TrainingPlansWrite]);
    expect(requiredScopesForRequest({ method: 'tools/call', params: { name: 'preview_training_changes', arguments: {
      expectedScheduleRevision: 1, changes: [{ kind: 'provider-delivery' }],
    } } })).toEqual([MCP_OAUTH_SCOPES.TrainingPlansRead, MCP_OAUTH_SCOPES.TrainingDeliveryWrite]);
    expect(requiredScopesForRequest({ method: 'tools/call', params: { name: 'apply_training_changes', arguments: {
      proposalRef: 'opaque', permissionMode: 'combined',
    } } })).toEqual([MCP_OAUTH_SCOPES.TrainingPlansRead, MCP_OAUTH_SCOPES.TrainingPlansWrite,
      MCP_OAUTH_SCOPES.TrainingDeliveryWrite]);
  });

  it('advertises live readiness drivers and the daily health and Training report', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [
        MCP_OAUTH_SCOPES.MetricsRead,
        MCP_OAUTH_SCOPES.SleepRead,
      ],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'daily-briefing-metadata-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = (await client.listTools()).tools;
      const dailyBriefing = tools
        .find(tool => tool.name === 'get_daily_briefing');
      const dailyReport = tools
        .find(tool => tool.name === 'get_daily_report');
      const todayReadiness = tools
        .find(tool => tool.name === 'get_today_readiness');
      const instructions = client.getInstructions() || '';
      const priorityPrefix = instructions.slice(0, 512);

      expect(instructions).toContain(
        'use get_daily_report',
      );
      expect(priorityPrefix).toContain('get_daily_report');
      expect(priorityPrefix).toContain('get_sleep_trend');
      expect(priorityPrefix).toContain('get_current_readiness');
      expect(priorityPrefix).toContain(
        'current recovery score and its evidence',
      );
      expect(priorityPrefix).toContain('IANA time zone');
      expect(instructions).toContain(
        'summarize readiness in one sentence using at most the two most relevant available drivers',
      );
      expect(todayReadiness?.description).toContain(
        'Legacy formula-3 readiness for compatibility',
      );
      expect(todayReadiness?.description).toContain('same-provider baseline medians');
      expect(dailyReport?.description).toContain(
        'aggregate average/overnight HRV and average/minimum sleep heart rate',
      );
      expect(dailyReport?.description).toContain(
        'keep readiness to one sentence',
      );
      expect(dailyBriefing?.description).toContain(
        'current-versus-usual equivalent 28-day Training totals',
      );
      expect(dailyBriefing?.description).toContain('Running/Cycling/Swimming mix');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('makes the static activity-type catalog available to every authorized client', () => {
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'list_activity_types' },
    })).toEqual([]);
  });

  it('requires separate activity-detail and route scopes for granular tools', () => {
    expect(requiredScopesForRequest({ method: 'tools/call', params: { name: 'get_readiness_history' } }))
      .toEqual([MCP_OAUTH_SCOPES.MetricsRead, MCP_OAUTH_SCOPES.SleepRead, MCP_OAUTH_SCOPES.HealthRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'list_activity_jumps' },
    })).toEqual([MCP_OAUTH_SCOPES.ActivityDetailsRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'query_activities' },
    })).toEqual([MCP_OAUTH_SCOPES.ActivityDetailsRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'get_route_geometry' },
    })).toEqual([
      MCP_OAUTH_SCOPES.RoutesRead,
      MCP_OAUTH_SCOPES.RouteLocationRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'find_activities_near_location' },
    })).toEqual([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.ActivityLocationRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'search_activities_near_location' },
    })).toEqual([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.ActivityLocationRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'find_routes_near_location' },
    })).toEqual([
      MCP_OAUTH_SCOPES.RoutesRead,
      MCP_OAUTH_SCOPES.RouteLocationRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'search_routes_near_location' },
    })).toEqual([
      MCP_OAUTH_SCOPES.RoutesRead,
      MCP_OAUTH_SCOPES.RouteLocationRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: {
        name: 'get_activity_chart_data',
        arguments: { includeLocation: false },
      },
    })).toEqual([MCP_OAUTH_SCOPES.ActivityDetailsRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: {
        name: 'get_activity_chart_data',
        arguments: { includeLocation: true },
      },
    })).toEqual([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.ActivityLocationRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'get_activity_metrics' },
    })).toEqual([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'get_activity_overview' },
    })).toEqual([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'rank_activities_by_metric' },
    })).toEqual([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
    ]);
  });

  it('registers only the tools granted by the bearer scopes', async () => {
    const listToolNames = async (
      scopes: Array<typeof MCP_OAUTH_SCOPES[keyof typeof MCP_OAUTH_SCOPES]>,
    ) => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createMcpServer({
        uid: 'user-1',
        clientId: 'https://client.example/mcp.json',
        connectionId: 'connection-1',
        scopes,
      }, 'https://quantified-self.io');
      const client = new Client({
        name: 'scope-test-client',
        version: '1.0.0',
      });
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        return (await client.listTools()).tools.map(tool => tool.name).sort();
      } finally {
        await client.close();
        await server.close();
      }
    };

    await expect(listToolNames([])).resolves.toEqual([
      'list_activity_types',
    ]);
    await expect(listToolNames([MCP_OAUTH_SCOPES.MetricsRead])).resolves.toEqual([
      'get_training_metric',
      'list_activity_types',
      'list_metrics',
      'list_training_metrics',
      'prepare_training_metrics',
      'query_metric',
      'query_metrics',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.MeasurementsRead,
    ])).resolves.toEqual([
      'list_activity_types',
      'list_measurement_types',
      'query_measurements',
    ]);
    await expect(listToolNames([MCP_OAUTH_SCOPES.SleepRead])).resolves.toEqual([
      'get_sleep_trend',
      'list_activity_types',
      'list_sleep_sessions',
      'list_sleep_vitals',
      'query_sleep_summary',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.SleepRead,
    ])).resolves.toEqual([
      'get_current_readiness',
      'get_daily_briefing',
      'get_daily_report',
      'get_sleep_trend',
      'get_today_readiness',
      'get_training_metric',
      'list_activity_types',
      'list_metrics',
      'list_sleep_sessions',
      'list_sleep_vitals',
      'list_training_metrics',
      'prepare_training_metrics',
      'query_metric',
      'query_metrics',
      'query_sleep_summary',
    ]);
    await expect(listToolNames([MCP_OAUTH_SCOPES.HealthRead])).resolves.toEqual([
      'list_activity_types', 'list_health_metrics', 'query_health_metric',
    ]);
    await expect(listToolNames([MCP_OAUTH_SCOPES.ActivityDetailsRead])).resolves.toEqual([
      'get_activity_chart_data',
      'get_activity_samples',
      'list_activities',
      'list_activity_chart_metrics',
      'list_activity_jumps',
      'list_activity_laps',
      'list_activity_swim_lengths',
      'list_activity_types',
      'query_activities',
      'query_activities_with_tags',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
    ])).resolves.toEqual([
      'get_activity_chart_data',
      'get_activity_metrics',
      'get_activity_overview',
      'get_activity_samples',
      'get_training_metric',
      'list_activities',
      'list_activity_chart_metrics',
      'list_activity_jumps',
      'list_activity_laps',
      'list_activity_swim_lengths',
      'list_activity_types',
      'list_metrics',
      'list_training_metrics',
      'prepare_training_metrics',
      'query_activities',
      'query_activities_with_tags',
      'query_metric',
      'query_metrics',
      'rank_activities_by_metric',
    ]);
    await expect(listToolNames([MCP_OAUTH_SCOPES.RoutesRead])).resolves.toEqual([
      'list_activity_types',
      'list_routes',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.RoutesRead,
      MCP_OAUTH_SCOPES.RouteLocationRead,
    ])).resolves.toEqual([
      'find_routes_near_location',
      'get_route_geometry',
      'list_activity_types',
      'list_route_waypoints',
      'list_routes',
      'search_routes_near_location',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.ActivityLocationRead,
    ])).resolves.toEqual([
      'find_activities_near_location',
      'get_activity_chart_data',
      'get_activity_samples',
      'list_activities',
      'list_activity_chart_metrics',
      'list_activity_jumps',
      'list_activity_laps',
      'list_activity_swim_lengths',
      'list_activity_types',
      'query_activities',
      'query_activities_with_tags',
      'search_activities_near_location',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.ActivityLocationRead,
      MCP_OAUTH_SCOPES.RoutesRead,
    ])).resolves.toEqual([
      'find_activities_near_location',
      'get_activity_chart_data',
      'get_activity_samples',
      'list_activities',
      'list_activity_chart_metrics',
      'list_activity_jumps',
      'list_activity_laps',
      'list_activity_swim_lengths',
      'list_activity_types',
      'list_routes',
      'query_activities',
      'query_activities_with_tags',
      'search_activities_near_location',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.TrainingPlansRead,
      MCP_OAUTH_SCOPES.TrainingPlansWrite,
      MCP_OAUTH_SCOPES.TrainingDeliveryWrite,
    ])).resolves.toEqual([
      'apply_training_changes',
      'assess_planned_workout_compatibility',
      'get_planned_workout',
      'get_planned_workout_completion',
      'get_planned_workout_completions',
      'get_planned_workout_v2',
      'get_strength_workout_details',
      'get_training_plan',
      'get_training_sync_status',
      'list_activity_types',
      'list_training_plans',
      'preview_create_planned_workout',
      'preview_planned_workout_v2_change',
      'preview_strength_workout_change',
      'preview_training_changes',
      'query_planned_workouts',
      'query_planned_workouts_by_date',
    ]);
  }, 15_000);

  it('advertises canonical workout authoring guidance only when Training writes are available', async () => {
    async function readInstructions(scopes: string[]): Promise<string> {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createMcpServer({
        uid: 'user-1', clientId: 'https://client.example/mcp.json', connectionId: 'connection-1', scopes,
      }, 'https://quantified-self.io');
      const client = new Client({ name: 'training-recipe-instructions-client', version: '1.0.0' });
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        return client.getInstructions() || '';
      } finally {
        await client.close();
        await server.close();
      }
    }

    const writeInstructions = await readInstructions([
      MCP_OAUTH_SCOPES.TrainingPlansRead,
      MCP_OAUTH_SCOPES.TrainingPlansWrite,
    ]);
    expect(writeInstructions).toContain('Construct non-strength workout recipes using stable unique node IDs');
    expect(writeInstructions).toContain('use get_planned_workout_v2 to read an authored pool length');
    expect(writeInstructions).toContain('use preview_planned_workout_v2_change for one create/update');
    expect(writeInstructions).toContain('query_planned_workouts_by_date');
    expect(writeInstructions).toContain('get_planned_workout_completions');
    expect(writeInstructions).toContain('local mapping assessment, not a live provider/account check');
    expect(writeInstructions).toContain('use preview_create_planned_workout exactly once');
    expect(writeInstructions).toContain('provider delivery is not available on this connection');
    expect(writeInstructions).toContain('Never retry a rejected preview unchanged');
    expect(writeInstructions).toContain('Pace is still stored as metres per second with pace presentation');
    expect(writeInstructions).toContain('Never invent a threshold or relative-target reference snapshot');
    expect(writeInstructions).toContain('Plan deletion must be the sole proposed change');
    expect(writeInstructions).toContain('never infer whether its workouts should become standalone');

    const combinedWriteInstructions = await readInstructions([
      MCP_OAUTH_SCOPES.TrainingPlansRead,
      MCP_OAUTH_SCOPES.TrainingPlansWrite,
      MCP_OAUTH_SCOPES.TrainingDeliveryWrite,
    ]);
    expect(combinedWriteInstructions).toContain('optional delivery object');
    expect(combinedWriteInstructions).not.toContain('provider delivery is not available on this connection');

    const readInstructionsOnly = await readInstructions([MCP_OAUTH_SCOPES.TrainingPlansRead]);
    expect(readInstructionsOnly).not.toContain('Construct workout recipes');
    expect(readInstructionsOnly).toContain('No planning edits or provider actions are available');

    const deliveryInstructionsOnly = await readInstructions([
      MCP_OAUTH_SCOPES.TrainingPlansRead,
      MCP_OAUTH_SCOPES.TrainingDeliveryWrite,
    ]);
    expect(deliveryInstructionsOnly).toContain('Only provider-delivery changes are available');
    expect(deliveryInstructionsOnly).not.toContain('preview_create_planned_workout');
  });

  it('advertises one focused workout-create contract without the batch operation union', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1', clientId: 'https://client.example/mcp.json', connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.TrainingPlansRead, MCP_OAUTH_SCOPES.TrainingPlansWrite],
    }, 'https://quantified-self.io');
    const client = new Client({ name: 'focused-workout-contract-client', version: '1.0.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tool = (await client.listTools()).tools.find(item => item.name === 'preview_create_planned_workout');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toEqual([
        'expectedScheduleRevision', 'localDate', 'title', 'structure',
      ]);
      expect(tool?.inputSchema.properties).toHaveProperty('planRef');
      expect(tool?.inputSchema.properties).not.toHaveProperty('delivery');
      expect(tool?.inputSchema.properties).not.toHaveProperty('kind');
      expect(tool?.inputSchema.properties).not.toHaveProperty('localKey');
      expect(tool?.inputSchema.properties).not.toHaveProperty('changes');
      expect(JSON.stringify(tool?.inputSchema)).not.toContain('client-owned-key');
      expect(Buffer.byteLength(JSON.stringify(tool), 'utf8')).toBeLessThan(12 * 1024);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('advertises focused initial delivery only when its independent grant is present', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1', clientId: 'https://client.example/mcp.json', connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.TrainingPlansRead, MCP_OAUTH_SCOPES.TrainingPlansWrite,
        MCP_OAUTH_SCOPES.TrainingDeliveryWrite],
    }, 'https://quantified-self.io');
    const client = new Client({ name: 'focused-workout-delivery-contract-client', version: '1.0.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tool = (await client.listTools()).tools.find(item => item.name === 'preview_create_planned_workout');
      expect(tool?.inputSchema.properties).toHaveProperty('delivery');
      expect(JSON.stringify(tool?.inputSchema.properties?.delivery)).toContain('all_connected');
      expect(JSON.stringify(tool?.inputSchema.properties?.delivery)).toContain('timeZone');
    } finally {
      await client.close();
      await server.close();
    }
  });


  it('advertises native approval metadata and applies one server-bound Training proposal call', async () => {
    const preview = {
      proposalRef: 'opaque-proposal-reference', expiresAtMs: Date.now() + 60_000,
      permissionMode: 'schedule' as const, scheduleRevision: 1,
      summary: 'One Training change requires confirmation.', requiresConfirmation: true as const,
      changes: [{ index: 0, kind: 'rename-plan', summary: 'Rename the plan.' }], providerPreviews: [],
    };
    const applied = {
      proposalRef: preview.proposalRef, status: 'applied' as const, scheduleRevision: 2,
      changes: [{ index: 0, kind: 'rename-plan', status: 'applied' as const, message: 'Renamed the plan.' }],
      providers: [], createdReferences: [],
    };
    const applyTrainingChanges = vi.fn().mockResolvedValue(applied);
    const dataService = {
      applyTrainingChanges,
    } as unknown as NonNullable<Parameters<typeof createMcpServer>[2]>;
    const auth = {
      uid: 'user-1', clientId: 'https://client.example/mcp.json', connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.TrainingPlansRead, MCP_OAUTH_SCOPES.TrainingPlansWrite],
    };
    const server = createMcpTransportHandler(
      () => createMcpServer(auth, 'https://quantified-self.io', dataService),
      error => { throw error; },
    );
    const transport = new StreamableHTTPClientTransport(new URL('https://contract.example/mcp'), {
      fetch: (url, init) => server.fetch(new Request(url, init)),
    });
    const client = new Client({ name: 'training-native-approval-client', version: '1.0.0' }, {
      versionNegotiation: { mode: { pin: '2026-07-28' } },
    });

    try {
      await client.connect(transport);
      const applyTool = (await client.listTools()).tools.find(
        tool => tool.name === 'apply_training_changes',
      );
      expect(applyTool?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
      const result = await client.callTool({ name: 'apply_training_changes', arguments: {
        proposalRef: preview.proposalRef, permissionMode: 'schedule',
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(applied);
      expect(applyTrainingChanges).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
    }
  });

  it('advertises bounded saved-route type and name filters', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.RoutesRead],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'route-filter-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listRoutes = (await client.listTools()).tools
        .find(tool => tool.name === 'list_routes');
      const inputSchema = listRoutes?.inputSchema as {
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
      } | undefined;

      expect(client.getInstructions()).toContain(
        'list_routes with activityTypes or search',
      );
      expect(client.getInstructions()).toContain(
        'Repeat the filters with nextCursor until matched or scanComplete',
      );
      expect(listRoutes?.description).toContain('activityTypes');
      expect(listRoutes?.description).toContain(
        'case-insensitive route-name search',
      );
      expect(listRoutes?.description).toContain('scanComplete');
      expect(inputSchema?.required || []).not.toContain('activityTypes');
      expect(inputSchema?.required || []).not.toContain('search');
      expect(inputSchema?.properties?.activityTypes?.description).toContain(
        'list_activity_types',
      );
      expect(inputSchema?.properties?.search?.description).toContain(
        'case-insensitive',
      );
      expect(inputSchema?.properties?.cursor?.description).toContain(
        'Repeat the original activityTypes and search',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('advertises first-class body-measurement routing and safe tool metadata', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [
        MCP_OAUTH_SCOPES.MeasurementsRead,
        MCP_OAUTH_SCOPES.MetricsRead,
      ],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'measurement-metadata-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = (await client.listTools()).tools;
      const listMeasurements = tools.find(tool => tool.name === 'list_measurement_types');
      const queryMeasurements = tools.find(tool => tool.name === 'query_measurements');
      const queryMetric = tools.find(tool => tool.name === 'query_metric');
      const measurementCatalog = await client.callTool({
        name: 'list_measurement_types',
        arguments: {},
      });

      expect(client.getInstructions()).toContain('body weight, body mass, weigh-ins');
      expect(client.getInstructions()).toContain('not a medical or health assessment');
      expect(client.getInstructions()).toContain('Use list_metrics and query_metric for activity');
      expect(listMeasurements?.description).toContain('body weight');
      expect(queryMeasurements?.description).toContain('identity-free');
      expect(queryMeasurements?.description).toContain('provider, device, source, event, and activity identity are excluded');
      expect(queryMeasurements?.description).toContain('not a medical or health assessment');
      expect(queryMetric?.description).toContain('use query_measurements');
      expect(queryMeasurements?.inputSchema).toMatchObject({
        properties: {
          measurementType: {
            enum: ['body_weight'],
          },
          aggregation: {
            default: 'median',
          },
          interval: {
            default: 'day',
          },
          timeZone: {
            description: expect.stringContaining('Required IANA time zone'),
          },
        },
      });
      expect(measurementCatalog.structuredContent).toMatchObject({
        measurementTypes: [{
          id: 'body_weight',
          requiresExplicitIanaTimeZone: true,
          currentTrend: {
            requiredScope: 'metrics:read',
            dayBoundaryTimeZone: 'UTC',
          },
        }],
      });
      expect(queryMeasurements?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('does not instruct connections to use tools outside their granted scopes', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.SleepRead],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'sleep-instructions-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getInstructions()).toContain(
        'tools exposed for the permissions this connection was granted',
      );
      expect(client.getInstructions()).not.toContain('query_measurements');
      expect(client.getInstructions()).not.toContain('list_metrics');
      expect(client.getInstructions()).not.toContain('list_activities');
      expect(client.getInstructions()).not.toContain('body weight');
      expect(client.getInstructions()).toContain(
        'use get_sleep_trend with the requested period',
      );
      const tools = (await client.listTools()).tools;
      expect(tools.find(tool => tool.name === 'get_sleep_trend')?.description)
        .toContain('recent sleep changes');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([false, true])('reserves chart parsing for visual overviews with metrics access %s', async includeMetrics => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1', clientId: 'https://client.example/mcp.json', connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.ActivityDetailsRead, ...(includeMetrics ? [MCP_OAUTH_SCOPES.MetricsRead] : [])],
    }, 'https://quantified-self.io');
    const client = new Client({name: 'sample-routing-test-client', version: '1.0.0'});
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const instructions = client.getInstructions() || '';
      expect(instructions).toContain('Use existing activity summaries for ordinary workout overviews');
      expect(instructions).toContain('Use get_activity_chart_data for a visual overview');
      expect(instructions).not.toContain('For an activity overview use get_activity_chart_data');
      expect(instructions.includes('Use get_activity_overview before granular activity reads')).toBe(includeMetrics);
      const sampleTool = (await client.listTools()).tools.find(tool => tool.name === 'get_activity_samples');
      expect(sampleTool?.description).toContain('prefer persisted summaries for workout overviews and chart data for visual overviews');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('advertises recent-jump discovery with activity-detail access alone', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.ActivityDetailsRead],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'recent-jump-instructions-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const instructions = client.getInstructions() || '';
      expect(instructions).toContain(
        'select the first activity with jumpCount greater than zero',
      );
      expect(instructions).toContain('never an activity start or end position');
      expect(instructions).not.toContain('rank_activities_by_metric');
      const tools = (await client.listTools()).tools;
      expect(tools.map(tool => tool.name)).toContain('query_activities');
      expect(tools.map(tool => tool.name)).toContain('list_activity_jumps');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('routes specific and latest-workout requests to newest-first activity discovery', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [
        MCP_OAUTH_SCOPES.ActivityDetailsRead,
        MCP_OAUTH_SCOPES.MetricsRead,
        MCP_OAUTH_SCOPES.MeasurementsRead,
      ],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'activity-routing-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const instructions = client.getInstructions() || '';
      const activityInstructionIndex = instructions.indexOf(
        'For a workout',
      );
      const cursorInstruction = 'Follow nextCursor until matched or scanComplete';
      const cursorInstructionIndex = instructions.indexOf(cursorInstruction);
      const tools = (await client.listTools()).tools;
      const queryActivities = tools
        .find(tool => tool.name === 'query_activities');
      const queryActivitiesWithTags = tools
        .find(tool => tool.name === 'query_activities_with_tags');
      const rankActivities = tools
        .find(tool => tool.name === 'rank_activities_by_metric');
      const listActivityTypes = tools
        .find(tool => tool.name === 'list_activity_types');
      const inputSchema = queryActivities?.inputSchema as {
        properties?: Record<string, Record<string, unknown>>;
        oneOf?: Array<{
          title?: string;
          required?: string[];
          not?: unknown;
        }>;
        required?: string[];
      } | undefined;
      const taggedInputSchema = queryActivitiesWithTags?.inputSchema as {
        properties?: Record<string, {
          description?: string;
          maxItems?: number;
          minItems?: number;
          enum?: string[];
        }>;
        oneOf?: Array<{ title?: string }>;
      } | undefined;
      const rankingInputSchema = rankActivities?.inputSchema as {
        properties?: Record<string, {
          description?: string;
        }>;
        oneOf?: Array<{
          title?: string;
          required?: string[];
          not?: unknown;
        }>;
        required?: string[];
      } | undefined;

      expect(activityInstructionIndex).toBeGreaterThanOrEqual(0);
      expect(activityInstructionIndex).toBeLessThan(512);
      expect(cursorInstructionIndex).toBeGreaterThan(activityInstructionIndex);
      expect(cursorInstructionIndex + cursorInstruction.length)
        .toBeLessThanOrEqual(512);
      expect(instructions).toContain(
        'aggregate metrics do not contain individual records',
      );
      expect(instructions).toContain(
        'relativePeriod plus timeZone for today or yesterday',
      );
      expect(instructions).toContain(
        'add activityTypes and limit 1 when named',
      );
      expect(instructions).toContain(
        'Use get_activity_overview before granular activity reads',
      );
      expect(instructions).toContain('are Unix epoch milliseconds');
      expect(instructions).toContain('relative offsets such as jump timestampMs');
      expect(instructions).toContain('rank_activities_by_metric');
      expect(instructions).toContain('Maximum Jump Distance');
      expect(instructions).toContain('Treat the ranked metric value as authoritative');
      expect(instructions).toContain("use that ranked activity's exact ISO startTime");
      expect(instructions).toContain('never substitute the current date');
      expect(instructions).toContain('only when jump-level details are requested');
      expect(instructions).toContain('Never rank jump quality by jumpCount');
      expect(instructions).toContain('select the first activity with jumpCount greater than zero');
      expect(instructions).toContain('never an activity start or end position');
      expect(listActivityTypes).toBeDefined();
      expect(queryActivities?.description).toContain('relativePeriod/timeZone');
      expect(queryActivities?.description).toContain('unbounded history');
      expect(inputSchema?.required || []).not.toContain('start');
      expect(inputSchema?.required || []).not.toContain('end');
      expect(inputSchema?.required || []).not.toContain('relativePeriod');
      expect(inputSchema?.required || []).not.toContain('timeZone');
      expect(inputSchema?.properties?.start?.description).toContain(
        'Provide together with end',
      );
      expect(inputSchema?.properties?.activityTypes?.description).toContain(
        'list_activity_types',
      );
      expect(inputSchema?.properties?.relativePeriod?.description).toContain(
        'Requires timeZone',
      );
      expect(inputSchema?.properties?.timeZone?.description).toContain(
        'IANA time zone',
      );
      expect(inputSchema?.properties?.limit?.description).toContain(
        'server-filtered named activity type',
      );
      expect(inputSchema?.oneOf).toHaveLength(3);
      expect(inputSchema?.oneOf?.map(option => option.title)).toEqual([
        'Explicit date range',
        'Relative date range',
        'Unbounded newest-first history',
      ]);
      expect(inputSchema?.oneOf?.[0]?.required).toEqual(['start', 'end']);
      expect(inputSchema?.oneOf?.[1]?.required).toEqual([
        'relativePeriod',
        'timeZone',
      ]);
      expect(inputSchema?.oneOf?.[2]?.not).toBeDefined();
      expect(queryActivitiesWithTags?.description).toContain(
        'exact case-insensitive tag matches',
      );
      expect(queryActivitiesWithTags?.description).toContain(
        'sibling activities',
      );
      expect(queryActivitiesWithTags?.description).toContain(
        'location fields are always redacted',
      );
      expect(JSON.stringify(queryActivitiesWithTags?.inputSchema)).toContain(
        'Repeat the original activityTypes, tags, tagMatch',
      );
      expect(taggedInputSchema?.properties?.tags).toMatchObject({
        minItems: 1,
        maxItems: 10,
      });
      expect(taggedInputSchema?.properties?.tagMatch?.enum).toEqual([
        'any',
        'all',
      ]);
      expect(taggedInputSchema?.oneOf).toHaveLength(3);
      expect(instructions).toContain('Use query_activities_with_tags');
      expect(instructions).toContain('Tag matches are exact and case-insensitive');
      expect(instructions).toContain('untrusted labels');
      expect(queryActivitiesWithTags?.description).toContain(
        'untrusted label data',
      );
      expect(rankActivities?.description).toContain('all history');
      expect(rankActivities?.description).toContain('ranked Maximum Jump metric is authoritative');
      expect(rankingInputSchema?.properties?.activityGroup?.description)
        .toContain('activityGroup from list_activity_types');
      expect(rankingInputSchema?.required || []).not.toContain('start');
      expect(rankingInputSchema?.required || []).not.toContain('end');
      expect(rankingInputSchema?.required || []).not.toContain('activityGroup');
      expect(rankingInputSchema?.oneOf?.map(option => option.title)).toEqual([
        'Explicit date range',
        'All available history',
      ]);
      expect(rankingInputSchema?.oneOf?.[0]?.required).toEqual(['start', 'end']);
      expect(rankingInputSchema?.oneOf?.[1]?.not).toBeDefined();

      const partialRange = await client.callTool({
        name: 'query_activities',
        arguments: {
          start: '2026-07-27T00:00:00.000+03:00',
        },
      });
      expect(partialRange.isError).toBe(true);
      expect(JSON.stringify(partialRange)).toContain(
        'Choose exactly one date mode',
      );

      const missingRelativeTimeZone = await client.callTool({
        name: 'query_activities',
        arguments: {
          relativePeriod: 'today',
        },
      });
      expect(missingRelativeTimeZone.isError).toBe(true);
      expect(JSON.stringify(missingRelativeTimeZone)).toContain(
        'Choose exactly one date mode',
      );

      const combinedModes = await client.callTool({
        name: 'query_activities',
        arguments: {
          start: '2026-07-27T00:00:00.000+03:00',
          end: '2026-07-27T23:59:59.999+03:00',
          relativePeriod: 'today',
          timeZone: 'Europe/Helsinki',
        },
      });
      expect(combinedModes.isError).toBe(true);
      expect(JSON.stringify(combinedModes)).toContain(
        'Choose exactly one date mode',
      );

      const partialRankingRange = await client.callTool({
        name: 'rank_activities_by_metric',
        arguments: {
          metric: 'Maximum Jump Distance',
          start: '2026-07-27T00:00:00.000+03:00',
        },
      });
      expect(partialRankingRange.isError).toBe(true);
      expect(JSON.stringify(partialRankingRange)).toContain(
        'Provide both start and end',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('does not advertise measurement routing to a metrics-only connection', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'metrics-instructions-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const advertisedMetadata = JSON.stringify({
        instructions: client.getInstructions(),
        tools: (await client.listTools()).tools,
      });

      expect(advertisedMetadata).not.toContain('query_measurements');
      expect(advertisedMetadata).not.toContain('list_measurement_types');
      expect(client.getInstructions()).toContain(
        'Use list_metrics and query_metric for activity',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('marks read-only place searches as closed-world despite their bounded Mapbox lookup', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [
        MCP_OAUTH_SCOPES.ActivityDetailsRead,
        MCP_OAUTH_SCOPES.ActivityLocationRead,
        MCP_OAUTH_SCOPES.RoutesRead,
        MCP_OAUTH_SCOPES.RouteLocationRead,
      ],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'metadata-test-client',
      version: '1.0.0',
    });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = (await client.listTools()).tools;
      for (const toolName of [
        'search_activities_near_location',
        'search_routes_near_location',
      ]) {
        expect(tools.find(tool => tool.name === toolName)?.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        });
      }
      for (const legacyToolName of [
        'find_activities_near_location',
        'find_routes_near_location',
      ]) {
        expect(
          tools.find(tool => tool.name === legacyToolName)?.annotations,
        ).toMatchObject({
          openWorldHint: true,
        });
      }
      const nearbyActivitySchema = tools.find(
        tool => tool.name === 'search_activities_near_location',
      )?.inputSchema as {
        oneOf?: Array<{ title?: string; required?: string[]; not?: unknown }>;
      } | undefined;
      expect(nearbyActivitySchema?.oneOf).toHaveLength(2);
      expect(nearbyActivitySchema?.oneOf?.[0]).toMatchObject({
        title: 'Explicit date range',
        required: ['start', 'end'],
      });
      expect(nearbyActivitySchema?.oneOf?.[1]).toMatchObject({
        title: 'Unbounded newest-first history',
      });
      expect(nearbyActivitySchema?.oneOf?.[1]?.not).toBeDefined();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects ambiguous location objects before a nearby tool can execute', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [
        MCP_OAUTH_SCOPES.ActivityDetailsRead,
        MCP_OAUTH_SCOPES.ActivityLocationRead,
      ],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'schema-test-client',
      version: '1.0.0',
    });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({
        name: 'search_activities_near_location',
        arguments: {
          location: {
            query: 'Ioannina, Greece',
            latitudeDegrees: 39.665,
            longitudeDegrees: 20.8537,
          },
        },
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('Invalid input');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('discloses exact start and end coordinates in the activity tool metadata', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [
        MCP_OAUTH_SCOPES.ActivityDetailsRead,
        MCP_OAUTH_SCOPES.ActivityLocationRead,
      ],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'metadata-test-client',
      version: '1.0.0',
    });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listActivities = (await client.listTools()).tools
        .find(tool => tool.name === 'list_activities');

      expect(listActivities?.description).toContain('exact start and end coordinates when present');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('advertises compact hosted app icons for MCP clients', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
    }, 'https://beta.quantified-self.io');
    const client = new Client({
      name: 'icon-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getServerVersion()).toEqual({
        name: 'quantified-self',
        title: 'Quantified Self',
        version: '1.4.0',
        description: 'Permission-scoped activity, Health, sleep, measurements, Timeline notes, and Training access, including explicitly authorized changes.',
        websiteUrl: 'https://beta.quantified-self.io',
        icons: [
          {
            src: 'https://beta.quantified-self.io/assets/favicons/android-chrome-96x96.png',
            mimeType: 'image/png',
            sizes: ['96x96'],
          },
          {
            src: 'https://beta.quantified-self.io/assets/favicons/android-chrome-192x192.png',
            mimeType: 'image/png',
            sizes: ['192x192'],
          },
          {
            src: 'https://beta.quantified-self.io/assets/favicons/android-chrome-512x512.png',
            mimeType: 'image/png',
            sizes: ['512x512'],
          },
        ],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('does not assign a scope to protocol messages or unknown tools', () => {
    expect(requiredScopesForRequest({ method: 'initialize' })).toEqual([]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'unknown' },
    })).toEqual([]);
  });

  it('keeps the stateless JSON transport on bounded POST requests', () => {
    expect(supportsMcpTransportMethod('POST')).toBe(true);
    expect(supportsMcpTransportMethod('GET')).toBe(false);
    expect(supportsMcpTransportMethod('DELETE')).toBe(false);
    expect(isMcpRequestBodyWithinLimit({ method: 'initialize' }, '24')).toBe(true);
    expect(isMcpRequestBodyWithinLimit({ payload: 'x'.repeat(70_000) }, undefined)).toBe(false);
    expect(isMcpRequestBodyWithinLimit({ payload: 'x'.repeat(70_000) }, undefined, 320 * 1024)).toBe(true);
    expect(isMcpRequestBodyWithinLimit({ payload: 'x'.repeat(330_000) }, undefined, 320 * 1024)).toBe(false);
    expect(mcpToolRequestBodyLimit({ method: 'tools/call', params: { name: 'update_event_description' } }))
      .toBe(320 * 1024);
    expect(mcpToolRequestBodyLimit({ method: 'tools/call', params: { name: 'update_event_title' } }))
      .toBe(64 * 1024);
    expect(mcpToolRequestBodyLimit([{ method: 'tools/call', params: { name: 'update_event_description' } }]))
      .toBe(64 * 1024);
    expect(isMcpRequestBodyWithinLimit({}, 'not-a-number')).toBe(false);
  });

  it('preserves repeated form parameters for strict OAuth validation', () => {
    const parsed = parseMcpFormEncodedBody(
      'grant_type=refresh_token&scope=metrics%3Aread&scope=sleep%3Aread',
    );
    expect(parsed).toEqual({
      grant_type: 'refresh_token',
      scope: ['metrics:read', 'sleep:read'],
    });
    expect(() => rejectRepeatedOAuthParameters(parsed)).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
  });

  it('accepts only form-encoded OAuth token requests', () => {
    expect(isMcpFormUrlEncodedContentType('application/x-www-form-urlencoded')).toBe(true);
    expect(isMcpFormUrlEncodedContentType(
      'Application/X-Www-Form-Urlencoded; charset=UTF-8',
    )).toBe(true);
    expect(isMcpFormUrlEncodedContentType(
      'application/x-www-form-urlencoded; charset="utf8"',
    )).toBe(true);
    expect(isMcpFormUrlEncodedContentType(
      'application/x-www-form-urlencoded; charset=ISO-8859-1',
    )).toBe(false);
    expect(isMcpFormUrlEncodedContentType(
      'application/x-www-form-urlencoded; charset=UTF-8; charset=UTF-8',
    )).toBe(false);
    expect(isMcpFormUrlEncodedContentType(
      'application/x-www-form-urlencoded; charset=""',
    )).toBe(false);
    expect(isMcpFormUrlEncodedContentType('application/json')).toBe(false);
    expect(isMcpFormUrlEncodedContentType(undefined)).toBe(false);
  });

  it('requires unambiguous ISO date-times with a UTC offset', () => {
    expect(parseMcpDateTime('2024-01-01T00:00:00Z', 'start'))
      .toBe(Date.parse('2024-01-01T00:00:00Z'));
    expect(parseMcpDateTime('2024-01-01T02:00:00+02:00', 'start'))
      .toBe(Date.parse('2024-01-01T00:00:00Z'));
    expect(() => parseMcpDateTime('01/02/2024', 'start')).toThrow(McpDataError);
    expect(() => parseMcpDateTime('2024-01-01', 'start')).toThrow(McpDataError);
  });

  it('does not disclose unexpected backend error messages through tool results', () => {
    expect(formatMcpToolError(new Error('users/private-user/secret-path'))).toEqual({
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'internal_error',
          message: 'The MCP tool could not complete the request.',
        }),
      }],
    });
    expect(formatMcpToolError(new McpDataError('invalid_metric', 'Unknown metric.')))
      .toEqual(expect.objectContaining({
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'invalid_metric',
            message: 'Unknown metric.',
          }),
        }],
      }));
  });

  it('logs only bounded Zod issue paths and codes for output validation failures', () => {
    const parsed = z.strictObject({
      readiness: z.strictObject({
        drivers: z.strictObject({
          load: z.number(),
        }),
      }),
    }).safeParse({
      readiness: {
        drivers: {
          load: 'private-health-value',
        },
      },
    });
    if (parsed.success) {
      throw new Error('Expected the diagnostic fixture to fail validation.');
    }

    const summary = summarizeMcpOutputValidationIssues(parsed.error);

    expect(summary).toEqual([{
      code: 'invalid_type',
      path: ['readiness', 'drivers', 'load'],
    }]);
    expect(JSON.stringify(summary)).not.toContain('private-health-value');
    expect(summarizeMcpOutputValidationIssues(
      new Error('users/private-user/secret-path'),
    )).toBeNull();
  });

  it('distinguishes invalid tokens, rate limits, and backend authentication failures', () => {
    expect(classifyMcpBearerFailure(
      new McpOAuthError('invalid_grant', 'expired', 401),
    )).toEqual({
      statusCode: 401,
      error: 'invalid_token',
      challengeError: 'invalid_token',
    });
    expect(classifyMcpBearerFailure(
      new McpOAuthError('temporarily_unavailable', 'limited', 429),
    )).toEqual({
      statusCode: 429,
      error: 'temporarily_unavailable',
      retryAfterSeconds: 60,
    });
    expect(classifyMcpBearerFailure(new Error('firestore unavailable'))).toEqual({
      statusCode: 503,
      error: 'temporarily_unavailable',
    });
  });

  it('classifies bearer diagnostics without retaining authentication material', () => {
    expect(classifyMcpDiagnosticClientFamily('codex-mcp-client/0.151.0-alpha.7.2'))
      .toBe('codex');
    expect(classifyMcpDiagnosticClientFamily('Claude-User')).toBe('claude');
    expect(classifyMcpDiagnosticClientFamily('curl/8.7.1')).toBe('automation');
    expect(classifyMcpDiagnosticClientFamily(undefined)).toBe('unknown');

    const rejection = classifyMcpBearerRejectionReason(
      new McpBearerAuthenticationError(
        'superseded_grant',
        'The MCP authorization grant was superseded.',
      ),
    );
    expect(rejection).toBe('superseded_grant');
    expect(JSON.stringify({ rejection })).not.toContain('token-value');
    expect(classifyMcpBearerRejectionReason(
      new McpOAuthError('temporarily_unavailable', 'limited', 429),
    )).toBe('request_rate_limited');
  });

  it('classifies Streamable HTTP rejections to a fixed safe vocabulary', () => {
    expect(classifyMcpTransportRejectionReason(
      new Error('Parse error: Invalid JSON-RPC message'),
    )).toBe('invalid_json_rpc');
    expect(classifyMcpTransportRejectionReason(
      new Error('Bad Request: Unsupported protocol version: untrusted-value'),
    )).toBe('unsupported_protocol_version');
    expect(classifyMcpTransportRejectionReason(
      new Error('untrusted request body: secret-value'),
    )).toBe('unexpected_transport_error');
  });

  it('retains only safe MCP protocol versions for rejection diagnostics', () => {
    expect(sanitizeMcpProtocolVersionForDiagnostics('2026-01-15')).toBe('2026-01-15');
    expect(sanitizeMcpProtocolVersionForDiagnostics(' DRAFT-2026-v1 ')).toBe('DRAFT-2026-v1');
    expect(sanitizeMcpProtocolVersionForDiagnostics('unsupported-version-secret')).toBe('invalid_or_absent');
    expect(sanitizeMcpProtocolVersionForDiagnostics(undefined)).toBe('invalid_or_absent');
  });

  it('reports unsupported OAuth token grants with the standard error code', () => {
    expect(requireMcpTokenGrantType('authorization_code')).toBe('authorization_code');
    expect(requireMcpTokenGrantType('refresh_token')).toBe('refresh_token');
    expect(() => requireMcpTokenGrantType('')).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
    expect(() => requireMcpTokenGrantType(['refresh_token', 'refresh_token'])).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
    expect(() => requireMcpTokenGrantType('client_credentials')).toThrow(
      expect.objectContaining({ code: 'unsupported_grant_type' }),
    );
  });

  it('parses the case-insensitive Bearer authorization scheme strictly', () => {
    expect(parseMcpBearerToken('Bearer token-value')).toBe('token-value');
    expect(parseMcpBearerToken('bearer token-value')).toBe('token-value');
    expect(parseMcpBearerToken('BEARER   token-value')).toBe('token-value');
    expect(parseMcpBearerToken('Basic token-value')).toBeNull();
    expect(parseMcpBearerToken('Bearer token value')).toBeNull();
  });

  it('handles an initialize request through the pinned stateless HTTP adapter', async () => {
    const httpServer = createHttpServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', async () => {
        const server = new McpServer({ name: 'adapter-test', version: '1.0.0' });
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        try {
          await server.connect(transport);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          await transport.handleRequest(request, response, body);
        } finally {
          await transport.close();
          await server.close();
        }
      });
    });
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: {
              name: 'adapter-test-client',
              version: '1.0.0',
            },
          },
        }),
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body).toEqual(expect.objectContaining({
        jsonrpc: '2.0',
        id: 1,
        result: expect.objectContaining({
          serverInfo: {
            name: 'adapter-test',
            version: '1.0.0',
          },
        }),
      }));
    } finally {
      await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
    }
  });
});
