import { describe, expect, it } from 'vitest';
import {
  PUBLIC_FEATURE_PATHS,
  PUBLIC_GUIDE_PATHS,
  PUBLIC_SEO_PAGES,
  PUBLIC_SEO_ROUTE_DATA,
} from './public-seo-pages.content';

describe('public-seo-pages.content', () => {
  it('defines distinct public feature and guide paths', () => {
    expect(PUBLIC_FEATURE_PATHS).toEqual({
      hub: 'features',
      activityCalendar: 'features/activity-calendar',
      trainingAnalysis: 'features/training-analysis',
      trainingDashboard: 'features/training-dashboard',
      activityMap: 'features/activity-map',
      mcpServer: 'features/mcp-server',
      assistant: 'features/ai-insights',
      fitGpxTcxFileAnalyzer: 'features/fit-gpx-tcx-file-analyzer',
      routeFiles: 'features/fit-gpx-route-files',
    });
    expect(PUBLIC_GUIDE_PATHS).toEqual({
      hub: 'guides',
      syncGarminToSuunto: 'guides/sync-garmin-to-suunto',
      syncCorosToSuunto: 'guides/sync-coros-to-suunto',
      syncWahooToSuunto: 'guides/sync-wahoo-to-suunto',
      importActivitiesToSuunto: 'guides/import-activities-to-suunto',
      importActivitiesToWahoo: 'guides/import-activities-to-wahoo',
      syncSuuntoRoutesToGarmin: 'guides/sync-suunto-routes-to-garmin-courses',
      centralizeWorkoutData: 'guides/centralize-garmin-suunto-coros-workout-data',
    });
  });

  it('keeps route metadata complete without meta-keywords', () => {
    for (const [key, page] of Object.entries(PUBLIC_SEO_PAGES)) {
      const routeData = PUBLIC_SEO_ROUTE_DATA[key as keyof typeof PUBLIC_SEO_ROUTE_DATA];

      expect(page.h1.trim().length).toBeGreaterThan(0);
      expect(page.description.trim().length).toBeGreaterThan(0);
      expect(page.sections.length).toBeGreaterThanOrEqual(2);
      expect(page.faqItems.length).toBeGreaterThanOrEqual(3);
      expect(page.actions.length).toBeGreaterThan(0);
      expect(routeData.title).toBe(page.title);
      expect(routeData.description).toBe(page.description);
      expect(routeData.publicSeoPage).toBe(page);
      expect(routeData).not.toHaveProperty('keywords');
      expect(routeData.jsonLd).toMatchObject({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: page.h1,
        url: `https://quantified-self.io/${page.path}`,
        inLanguage: 'en',
      });
    }

    expect(JSON.stringify(PUBLIC_SEO_PAGES)).not.toMatch(/\bprivate(?:ly)?\b/i);
  });

  it('keeps the new pages focused on separate search intents', () => {
    expect(PUBLIC_SEO_PAGES.featuresHub.h1).toBe('Features for endurance training data');
    expect(PUBLIC_SEO_PAGES.featuresHub.intro).toContain('compare recordings');
    expect(PUBLIC_SEO_PAGES.featuresHub.description).toContain('Garmin, Suunto, COROS, Wahoo');
    expect(PUBLIC_SEO_PAGES.featuresHub.description).toContain('AI answers');

    expect(PUBLIC_SEO_PAGES.activityCalendar.h1).toBe('Activity calendar for endurance training');
    expect(PUBLIC_SEO_PAGES.activityCalendar.description).toContain('Week, Month, and Year calendar views');
    expect(PUBLIC_SEO_PAGES.activityCalendar.intro).toContain('Garmin, Suunto, COROS, Wahoo');
    expect(PUBLIC_SEO_PAGES.activityCalendar.sections.some(section => (
      section.items.some(item => item.title === 'Duration-scaled activity circles')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.activityCalendar.sections.some(section => (
      section.items.some(item => item.title === 'Activity-group duration bars')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.activityCalendar.faqItems.some(item => (
      item.question === 'Does the activity calendar follow the dashboard event search?'
    ))).toBe(true);

    expect(PUBLIC_SEO_PAGES.trainingAnalysis.h1).toBe('Training analysis for endurance athletes');
    expect(PUBLIC_SEO_PAGES.trainingAnalysis.description).toContain('training load, readiness, intensity, durability');
    expect(PUBLIC_SEO_PAGES.trainingAnalysis.description).toContain('sport-specific trends');
    expect(PUBLIC_SEO_PAGES.trainingAnalysis.intro).toContain('recent training compares with your usual workload');
    expect(PUBLIC_SEO_PAGES.trainingAnalysis.sections.some(section => (
      section.copy.includes('Multisport legs')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.trainingAnalysis.sections.some(section => (
      section.items.some(item => item.copy.includes('critical power, W′, Pmax'))
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.trainingAnalysis.faqItems.some(item => item.question === 'How is Training different from the Dashboard?')).toBe(true);
    expect(PUBLIC_SEO_PAGES.trainingAnalysis.sections.map(section => section.preview)).toContain('training-snapshot');
    expect(PUBLIC_SEO_PAGES.trainingAnalysis.sections.map(section => section.preview)).toContain('training-signals');

    expect(PUBLIC_SEO_PAGES.trainingDashboard.h1).toBe('Build the training dashboard you need');
    expect(PUBLIC_SEO_PAGES.trainingDashboard.sections.some(section => section.preview === 'dashboard')).toBe(true);
    expect(PUBLIC_SEO_PAGES.activityMap.h1).toBe('See workouts, trips, and destinations on one map');
    expect(PUBLIC_SEO_PAGES.activityMap.description).toContain('group activity history into trips');
    expect(PUBLIC_SEO_PAGES.activityMap.sections.some(section => section.preview === 'activity-map')).toBe(true);
    expect(PUBLIC_SEO_PAGES.activityMap.sections.some(section => (
      section.items.some(item => item.title === 'Automatic trip detection')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.activityMap.sections.some(section => (
      section.items.some(item => item.copy.includes('weighted jump heatmap'))
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.activityMap.faqItems.some(item => (
      item.question === 'Does trip detection use my current location?'
      && item.answer.includes('recorded activity starts')
    ))).toBe(true);

    expect(PUBLIC_SEO_PAGES.mcpServer.h1).toBe('Connect ChatGPT or Claude to your training data');
    expect(PUBLIC_SEO_PAGES.mcpServer.description).toContain('ChatGPT, Claude, or another MCP client');
    expect(PUBLIC_SEO_PAGES.mcpServer.sections.some(section => (
      section.items?.some(item => item.title === 'Sleep, readiness, and daily context')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.mcpServer.sections.some(section => (
      section.items?.some(item => item.copy.includes('sleeping heart rate'))
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.mcpServer.sections.some(section => (
      section.items?.some(item => item.copy.includes('recent training trends'))
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.mcpServer.description).toContain('measurement, and route data you approve');
    expect(PUBLIC_SEO_PAGES.mcpServer.intro).toContain('plan your next workout');
    expect(PUBLIC_SEO_PAGES.mcpServer.sections.some(section => section.title === 'Ask about training, workouts, sleep, measurements, and routes')).toBe(true);
    expect(PUBLIC_SEO_PAGES.mcpServer.sections.some(section => section.copy.includes('disconnect it from Connections'))).toBe(true);
    expect(PUBLIC_SEO_PAGES.mcpServer.sections.some(section => section.items.some(item => item.copy.includes('body-weight history')))).toBe(true);
    expect(PUBLIC_SEO_PAGES.mcpServer.sections.some(section => section.items.some(item => item.copy.includes('Find recent activities')))).toBe(true);
    expect(PUBLIC_SEO_PAGES.mcpServer.sections.some(section => section.items.some(item => item.copy.includes('saved routes by sport, name, or recency')))).toBe(true);
    expect(PUBLIC_SEO_PAGES.mcpServer.faqItems.some(item => item.question === 'Can an MCP client rearrange my dashboard or change my data?')).toBe(true);
    expect(PUBLIC_SEO_PAGES.mcpServer.faqItems.some(item => item.question === 'Can I use the MCP server with ChatGPT or Claude?')).toBe(true);
    expect(PUBLIC_SEO_PAGES.mcpServer.faqItems.some(item => item.answer.includes('Granting one never exposes the other'))).toBe(true);
    expect(PUBLIC_SEO_PAGES.mcpServer.sections.some(section => section.preview === 'mcp-flow')).toBe(true);

    expect(PUBLIC_SEO_PAGES.assistant.h1).toBe('If you could ask your training history one question, what would it be?');
    expect(PUBLIC_SEO_PAGES.assistant.h1).not.toContain('complete training history');
    expect(PUBLIC_SEO_PAGES.assistant.description).toContain('sleep, readiness, training, measurements, activities, and routes');
    expect(PUBLIC_SEO_PAGES.assistant.description).toContain('answers grounded in your recorded data');
    expect(PUBLIC_SEO_PAGES.assistant.sections.some(section => (
      section.items.some(item => item.title === 'Grounded every turn')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.assistant.sections.some(section => (
      section.items.some(item => item.copy.includes('expires about seven days'))
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.assistant.sections.some(section => (
      section.items.some(item => item.title === 'Saved-route summaries')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.assistant.sections.some(section => (
      section.items.some(item => item.title === 'Charts and activity maps')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.assistant.sections.some(section => (
      section.items.some(item => item.copy.includes('MTB jump records'))
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.assistant.sections.some(section => (
      section.items.some(item => item.title === 'Precise activity locations stay opt-in')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.assistant.faqItems.some(item => (
      item.answer.includes('route names with place information')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.assistant.faqItems.some(item => (
      item.answer.includes('exact activity start/end and MTB jump coordinates')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.assistant.faqItems.some(item => (
      item.answer.includes('External MCP connections remain the advanced bring-your-own-AI path')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.assistant.faqItems.some(item => (
      item.answer.includes('your message, browser timezone, and bounded recent conversation context')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.assistant.faqItems.some(item => (
      item.answer.includes('Direct in-app URLs are withheld')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.assistant.faqItems.some(item => (
      item.answer.includes('displayed tile area to Mapbox')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.assistant.sections.some(section => section.preview === 'assistant-example')).toBe(true);

    expect(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer.h1).toBe('Analyze FIT, GPX, and TCX workout files');
    expect(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer.description).toContain('Upload FIT, GPX, TCX, JSON, or SML workouts');
    expect(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer.chips).toContain('GPX file analyzer');
    expect(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer.intro).toContain('maps, charts, stats, exports');
    expect(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer.faqItems.some(item => item.question === 'Can I analyze FIT files?')).toBe(true);
    expect(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer.faqItems.some(item => (
      item.question === 'Can I use Quantified Self as a FIT or GPX file viewer?'
      && item.answer.startsWith('Yes.')
    ))).toBe(true);
    expect(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer.sections.some(section => section.preview === 'workout-analysis')).toBe(true);

    expect(PUBLIC_SEO_PAGES.routeFiles.h1).toBe('Save FIT and GPX route files, then send them to connected services');
    expect(PUBLIC_SEO_PAGES.routeFiles.description).toContain('Save FIT courses and GPX routes');
    expect(PUBLIC_SEO_PAGES.routeFiles.description).toContain('send saved routes to Garmin Connect, Suunto');
    expect(PUBLIC_SEO_PAGES.routeFiles.description).toContain('Garmin Connect');
    expect(PUBLIC_SEO_PAGES.routeFiles.description).toContain('Wahoo');
    expect(PUBLIC_SEO_PAGES.routeFiles.description).toContain('COROS');
    expect(PUBLIC_SEO_PAGES.routeFiles.description).toContain('import Suunto routes');
    expect(PUBLIC_SEO_PAGES.routeFiles.sections.some(section => section.title === 'Move routes between Quantified Self and connected services')).toBe(true);
    const wahooCorosRouteItem = PUBLIC_SEO_PAGES.routeFiles.sections
      .flatMap(section => section.items || [])
      .find(item => item.title === 'Send saved routes to Wahoo or COROS');
    expect(wahooCorosRouteItem?.copy).toContain('Routes table or bulk actions');
    expect(wahooCorosRouteItem?.copy).toContain('COROS in the table, bulk actions, and route detail menu');
    expect(PUBLIC_SEO_PAGES.routeFiles.faqItems.some(item => item.question === 'Can I send saved routes to Suunto?')).toBe(true);
    expect(PUBLIC_SEO_PAGES.routeFiles.faqItems.some(item => item.question === 'Can I send saved routes to Garmin Connect?')).toBe(true);
    expect(PUBLIC_SEO_PAGES.routeFiles.faqItems.some(item => item.question === 'Can I send saved routes to Wahoo or COROS?')).toBe(true);
    expect(PUBLIC_SEO_PAGES.routeFiles.faqItems.some(item => item.question === 'Can Quantified Self import routes from Suunto?')).toBe(true);
    expect(PUBLIC_SEO_PAGES.routeFiles.faqItems.some(item => item.question === 'Are route files counted separately from activities?')).toBe(true);

    expect(PUBLIC_SEO_PAGES.guidesHub.h1).toBe('Training data sync guides');
    expect(PUBLIC_SEO_PAGES.guidesHub.description).toContain('Garmin to Suunto activity sync');
    expect(PUBLIC_SEO_PAGES.guidesHub.description).toContain('Wahoo to Suunto activity sync');
    expect(PUBLIC_SEO_PAGES.guidesHub.intro).toContain('centralized multi-provider workout archive');

    expect(PUBLIC_SEO_PAGES.syncGarminToSuunto.h1).toBe('How to sync Garmin data to Suunto automatically');
    expect(PUBLIC_SEO_PAGES.syncGarminToSuunto.howToSteps).toHaveLength(4);

    expect(PUBLIC_SEO_PAGES.syncWahooToSuunto.h1).toBe('How to sync Wahoo activities to Suunto automatically');
    expect(PUBLIC_SEO_PAGES.syncWahooToSuunto.description).toContain('Wahoo FIT activities');
    expect(PUBLIC_SEO_PAGES.syncWahooToSuunto.howToSteps).toHaveLength(4);
    expect(PUBLIC_SEO_PAGES.syncWahooToSuunto.faqItems.some(item => item.question === 'Will activities sent to Wahoo come back as Wahoo imports?')).toBe(true);

    expect(PUBLIC_SEO_PAGES.importActivitiesToSuunto.h1).toBe('How to import activities to Suunto');
    expect(PUBLIC_SEO_PAGES.importActivitiesToSuunto.description).toContain('FIT activities to Suunto');
    expect(PUBLIC_SEO_PAGES.importActivitiesToSuunto.faqItems.some(item => item.question === 'Can I import a GPX route to Suunto as an activity?')).toBe(true);
    expect(PUBLIC_SEO_PAGES.importActivitiesToSuunto.howToSteps).toHaveLength(4);

    expect(PUBLIC_SEO_PAGES.importActivitiesToWahoo.h1).toBe('How to import activities to Wahoo');
    expect(PUBLIC_SEO_PAGES.importActivitiesToWahoo.description).toContain('FIT-backed Garmin, COROS, and Suunto activities');
    expect(PUBLIC_SEO_PAGES.importActivitiesToWahoo.faqItems.some(item => item.question === 'Can I import a GPX route to Wahoo as an activity?')).toBe(true);
    expect(PUBLIC_SEO_PAGES.importActivitiesToWahoo.howToSteps).toHaveLength(4);

    expect(PUBLIC_SEO_PAGES.syncSuuntoRoutesToGarmin.h1).toBe('How to send Suunto routes to Garmin courses');
    expect(PUBLIC_SEO_PAGES.syncSuuntoRoutesToGarmin.description).toContain('Course Import');
    expect(PUBLIC_SEO_PAGES.syncSuuntoRoutesToGarmin.description).toContain('send routes already saved');
    expect(PUBLIC_SEO_PAGES.syncSuuntoRoutesToGarmin.howToSteps).toHaveLength(5);

    expect(PUBLIC_SEO_PAGES.centralizeWorkoutData.h1).toBe('Centralize Garmin, Suunto, COROS, and Wahoo workout data');
    expect(PUBLIC_SEO_PAGES.centralizeWorkoutData.intro).not.toContain('centralize Garmin Suunto and COROS workout data');
  });

  it('links hub pages to the focused feature and guide pages they introduce', () => {
    const featureHubLinks = [
      ...PUBLIC_SEO_PAGES.featuresHub.actions,
      ...PUBLIC_SEO_PAGES.featuresHub.closingActions,
    ].map(action => action.routerLink);
    const guideHubLinks = [
      ...PUBLIC_SEO_PAGES.guidesHub.actions,
      ...PUBLIC_SEO_PAGES.guidesHub.closingActions,
    ].map(action => action.routerLink);

    expect(featureHubLinks).toContain('/features/ai-insights');
    expect(featureHubLinks).toContain('/features/activity-calendar');
    expect(featureHubLinks).toContain('/features/supported-activities');
    expect(featureHubLinks).toContain('/features/training-analysis');
    expect(featureHubLinks).toContain('/features/training-dashboard');
    expect(featureHubLinks).toContain('/features/activity-map');
    expect(featureHubLinks).toContain('/features/mcp-server');
    expect(featureHubLinks).toContain('/features/workout-data-comparison');
    expect(featureHubLinks).toContain('/features/fit-gpx-tcx-file-analyzer');
    expect(featureHubLinks).toContain('/features/fit-gpx-route-files');
    expect(featureHubLinks).not.toContain('/features/workout-file-comparison');
    expect(featureHubLinks).not.toContain('/features/sports-watch-benchmark');
    expect(featureHubLinks).toContain('/integrations');
    expect(featureHubLinks).toContain('/guides');

    expect(guideHubLinks).toContain('/guides/sync-garmin-to-suunto');
    expect(guideHubLinks).toContain('/guides/sync-coros-to-suunto');
    expect(guideHubLinks).toContain('/guides/sync-wahoo-to-suunto');
    expect(guideHubLinks).toContain('/guides/import-activities-to-suunto');
    expect(guideHubLinks).toContain('/guides/import-activities-to-wahoo');
    expect(guideHubLinks).toContain('/guides/sync-suunto-routes-to-garmin-courses');
    expect(guideHubLinks).toContain('/guides/centralize-garmin-suunto-coros-workout-data');
    expect(guideHubLinks).toContain('/features');
    expect(guideHubLinks).toContain('/integrations');
  });

  it('keeps public feature calls to action out of authenticated workspaces', () => {
    const featurePages = [
      PUBLIC_SEO_PAGES.featuresHub,
      PUBLIC_SEO_PAGES.activityCalendar,
      PUBLIC_SEO_PAGES.trainingAnalysis,
      PUBLIC_SEO_PAGES.trainingDashboard,
      PUBLIC_SEO_PAGES.activityMap,
      PUBLIC_SEO_PAGES.mcpServer,
      PUBLIC_SEO_PAGES.assistant,
      PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer,
      PUBLIC_SEO_PAGES.routeFiles,
    ];
    const protectedWorkspaceRoutes = new Set(['/calendar', '/training', '/ai-insights', '/dashboard']);

    for (const page of featurePages) {
      const actionRoutes = [...page.actions, ...page.closingActions].map(action => action.routerLink);

      expect(actionRoutes.some(route => protectedWorkspaceRoutes.has(route)), page.path).toBe(false);
    }
  });

  it('keeps public feature meta descriptions concise', () => {
    const featurePages = [
      PUBLIC_SEO_PAGES.featuresHub,
      PUBLIC_SEO_PAGES.activityCalendar,
      PUBLIC_SEO_PAGES.trainingAnalysis,
      PUBLIC_SEO_PAGES.trainingDashboard,
      PUBLIC_SEO_PAGES.activityMap,
      PUBLIC_SEO_PAGES.mcpServer,
      PUBLIC_SEO_PAGES.assistant,
      PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer,
      PUBLIC_SEO_PAGES.routeFiles,
    ];

    for (const page of featurePages) {
      expect(page.description.length, page.path).toBeLessThanOrEqual(160);
    }
  });

  it('keeps HowTo JSON-LD step text aligned with visible guide steps', () => {
    for (const [key, page] of Object.entries(PUBLIC_SEO_PAGES)) {
      if (!page.howToSteps?.length) {
        continue;
      }

      const jsonLd = PUBLIC_SEO_ROUTE_DATA[key as keyof typeof PUBLIC_SEO_ROUTE_DATA].jsonLd;
      const mainEntity = jsonLd['mainEntity'] as Record<string, unknown>[];
      const howTo = mainEntity.find(entity => entity['@type'] === 'HowTo');
      const steps = howTo?.['step'] as Record<string, unknown>[];

      expect(steps).toHaveLength(page.howToSteps.length);

      for (const [index, step] of steps.entries()) {
        const expectedStep = page.howToSteps[index];

        expect(step).toMatchObject({
          '@type': 'HowToStep',
          position: index + 1,
          name: expectedStep,
          text: expectedStep,
        });
      }
    }
  });
});
