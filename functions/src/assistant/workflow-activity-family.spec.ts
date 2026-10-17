import {
  ActivityTypes, ActivityTypesHelper, DataActivityTypes, DataTrainingStressScore, EventImporterJSON,
} from '@sports-alliance/sports-lib';
import { describe, expect, it, vi } from 'vitest';
import { ASSISTANT_ANALYTICAL_PROMPT_WORKFLOWS } from '../../../shared/assistant.prompts';
import { getTrainingSportDefinition } from '../../../shared/training-disciplines';
import { createMcpDataService, type McpDataServiceDependencies } from '../mcp/data.service';
import { createMcpServer } from '../mcp/server';
import { createAssistantMcpSession } from './mcp-session';
import { createAssistantRuntime } from './runtime';

const now = new Date('2026-10-17T12:00:00.000Z');
const startDate = Date.parse('2026-10-16T08:00:00.000Z');
const cyclingTypes = [...new Set(getTrainingSportDefinition('cycling')!.contexts
  .flatMap(context => context.activityTypes)
  .flatMap(type => ActivityTypesHelper.resolveActivityType(type) || []))];
const metricInput = {
  metric: DataTrainingStressScore.type,
  start: '2026-10-01T00:00:00.000Z', end: now.toISOString(),
  aggregation: 'total', groupBy: 'date', interval: 'weekly', timeZone: 'UTC',
};

function fixture() {
  // One recording for every supported family member, one multisport recording
  // crossing the 20-type boundary with the candidate catalog, and an unrelated sport.
  const activities = [
    ...cyclingTypes.map(type => ({ types: [type], score: 1 })),
    { types: [cyclingTypes[0], cyclingTypes[cyclingTypes.length - 1]], score: 7 },
    { types: [ActivityTypes.Running], score: 1000 },
  ];
  const events = activities.map(({ types, score }, index) => ({
    id: `event-${index}`, cursor: index + 1,
    data: { startDate, endDate: startDate + 3_600_000,
      stats: { [DataActivityTypes.type]: types, [DataTrainingStressScore.type]: score } },
  }));
  const routes = activities.map(({ types }, index) => ({
    id: `route-${index}`, data: { name: `Route ${index}`, importedAt: new Date(startDate - index * 1000),
      activityTypes: types, routeCount: 1, waypointCount: 0, pointCount: 2, stats: {},
      sourceSummary: { providerRouteId: 'private-source' } },
  }));
  const fetchEventDocuments = vi.fn<McpDataServiceDependencies['fetchEventDocuments']>(
    async (_uid, _start, _end, _stats, limit, cursor) => {
      const offset = typeof cursor === 'number' ? cursor : 0;
      return events.slice(offset, offset + limit);
    },
  );
  const fetchRouteDocuments = vi.fn<McpDataServiceDependencies['fetchRouteDocuments']>(async (_uid, limit, cursor) => {
    const offset = cursor ? routes.findIndex(route => route.id === cursor.id) + 1 : 0;
    return routes.slice(offset, offset + limit);
  });
  // All executed reads are supplied here; no Firebase or provider access is used.
  const service = createMcpDataService({
    now: () => now.getTime(), fetchEventDocuments, fetchRouteDocuments,
    fetchSleepDocuments: vi.fn().mockResolvedValue([]),
    importEvent: (json, id) => EventImporterJSON.getEventFromJSON(json).setID(id),
  } as McpDataServiceDependencies);
  return { service, events, routes, fetchEventDocuments, fetchRouteDocuments };
}

describe('Assistant workflow family queries through real MCP validation', () => {
  it.each(ASSISTANT_ANALYTICAL_PROMPT_WORKFLOWS.filter(workflow => 'activityDisciplineOverrides' in workflow))(
    'executes $id over every canonical Cycling sport in one bounded scan', async workflow => {
      const f = fixture();
      const metric = vi.spyOn(f.service, 'queryMetric');
      const routes = vi.spyOn(f.service, 'listRoutes');
      const runtime = createAssistantRuntime({
        now: () => now,
        createMcpSession: (uid, url, ...options) => createAssistantMcpSession(uid, url, {
          createServer: (auth, baseUrl) => createMcpServer(auth, baseUrl, f.service),
        }, ...options),
        generateAnswer: async input => {
          for (const tool of input.tools) {
            // A model-selected subset (or oversized list) must not replace the
            // workflow's server-owned complete family.
            await tool.execute(tool.name === 'get_sleep_trend' ? {} : {
              ...metricInput, activityTypes: Array(25).fill(ActivityTypes.Running),
            });
          }
          return 'Compared the recorded evidence.';
        },
      });
      const answer = await runtime.answer({ uid: 'owner', appBaseUrl: 'https://quantified-self.io',
        prompt: workflow.examplePrompt, timeZone: 'UTC', history: [] });
      expect(answer.toolNames).toEqual(workflow.toolWorkflow);
      if (workflow.toolWorkflow.includes('query_metric')) {
        expect(metric).toHaveBeenCalledOnce();
        expect(metric.mock.calls[0][0].activityTypes).toBeUndefined();
        expect(metric.mock.calls[0][1]).toBe('cycling');
        const result = await metric.mock.results[0].value;
        expect(result.matchedEventCount).toBe(cyclingTypes.length + 1);
        expect(result.aggregation.buckets.reduce((sum, bucket) => sum + bucket.aggregateValue, 0))
          .toBe(cyclingTypes.length + 7);
        // Paging is by events only, never by overlapping sport subsets.
        expect(f.fetchEventDocuments).toHaveBeenCalledTimes(Math.floor(f.events.length / 25) + 1);
        expect(f.fetchRouteDocuments).not.toHaveBeenCalled();
      } else {
        expect(routes).toHaveBeenCalledOnce();
        expect(routes.mock.calls[0][0].activityTypes).toBeUndefined();
        expect(routes.mock.calls[0][1]).toBe('cycling');
        const result = await routes.mock.results[0].value;
        expect(result.routes).toHaveLength(cyclingTypes.length + 1);
        expect(new Set(result.routes.flatMap(route => route.activityTypes))).toEqual(new Set(cyclingTypes));
        expect(result).toMatchObject({ scannedRouteCount: f.routes.length, skippedRouteCount: 1,
          scanComplete: true, nextCursor: null });
        expect(JSON.stringify(result)).not.toContain('private-source');
        expect(f.fetchRouteDocuments).toHaveBeenCalledExactlyOnceWith('owner', 101, undefined, false);
        expect(f.fetchEventDocuments).not.toHaveBeenCalled();
      }
    },
  );

  it('keeps both public and service explicit-type limits at 20, including internal family calls', async () => {
    const f = fixture();
    const session = await createAssistantMcpSession('owner', 'https://quantified-self.io', {
      createServer: (auth, url) => createMcpServer(auth, url, f.service),
    });
    const activityTypes = Array(21).fill(ActivityTypes.Cycling);
    try {
      await expect(session.callTool('query_metric', { ...metricInput, activityTypes }))
        .rejects.toMatchObject({ code: 'invalid_tool_input' });
      await expect(session.callTool('list_routes', { activityTypes }))
        .rejects.toMatchObject({ code: 'invalid_tool_input' });
    } finally { await session.close(); }
    await expect(f.service.queryMetric({ uid: 'owner', metric: DataTrainingStressScore.type,
      startTimeMs: Date.parse(metricInput.start), endTimeMs: now.getTime(), aggregation: 'total',
      groupBy: 'date', interval: 'weekly', timeZone: 'UTC', activityTypes }, 'cycling'))
      .rejects.toThrow('At most 20 activity types');
    await expect(f.service.listRoutes({ uid: 'owner', connectionId: 'connection',
      appBaseUrl: 'https://quantified-self.io', activityTypes }, 'cycling'))
      .rejects.toThrow('At most 20 activity types');
    expect(f.fetchEventDocuments).not.toHaveBeenCalled();
    expect(f.fetchRouteDocuments).not.toHaveBeenCalled();
  });

  it('ignores internal family context for external clients and unadvertised tool arguments', async () => {
    const f = fixture();
    const session = await createAssistantMcpSession('owner', 'https://quantified-self.io', {
      createServer: (auth, url) => createMcpServer({ ...auth, clientId: 'external-client',
        assistantActivityDisciplines: { query_metric: 'cycling', list_routes: 'cycling' } }, url, f.service),
    });
    try {
      const result = await session.callTool('query_metric', { ...metricInput,
        activityTypes: [ActivityTypes.Running], assistantActivityDisciplines: { query_metric: 'cycling' } });
      expect(result.structuredContent.matchedEventCount).toBe(1);
      const routeResult = await session.callTool('list_routes', {
        activityTypes: [ActivityTypes.Running], assistantActivityDisciplines: { list_routes: 'cycling' },
      });
      expect(routeResult.structuredContent.routes).toHaveLength(1);
    } finally { await session.close(); }
  });

  it('retains work limits and binds route cursors to the complete family', async () => {
    const f = fixture();
    const input = { uid: 'owner', connectionId: 'connection', appBaseUrl: 'https://quantified-self.io', limit: 1 };
    const first = await f.service.listRoutes(input, 'cycling');
    expect(first.nextCursor).toEqual(expect.any(String));
    const continued = await f.service.listRoutes({ ...input, cursor: first.nextCursor! }, 'cycling');
    expect(first.routes[0].name).toBe('Route 0');
    expect(continued.routes[0].name).toBe('Route 1');
    await expect(f.service.listRoutes({ ...input, cursor: first.nextCursor! }, 'running'))
      .rejects.toMatchObject({ code: 'invalid_request' });
    f.fetchRouteDocuments.mockResolvedValueOnce(Array.from({ length: 102 }, () => f.routes[0]));
    await expect(f.service.listRoutes(input, 'cycling')).rejects.toMatchObject({ code: 'query_too_large' });
    f.fetchEventDocuments.mockResolvedValueOnce([{ ...f.events[0], data: { ...f.events[0].data,
      stats: { [DataTrainingStressScore.type]: 'x'.repeat(4 * 1024 * 1024 + 1) } } }]);
    await expect(f.service.queryMetric({ uid: 'owner', metric: DataTrainingStressScore.type,
      startTimeMs: Date.parse(metricInput.start), endTimeMs: now.getTime(), aggregation: 'total',
      groupBy: 'date', interval: 'weekly', timeZone: 'UTC' }, 'cycling'))
      .rejects.toMatchObject({ code: 'query_too_large' });
  });
});
