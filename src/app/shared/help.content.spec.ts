import { describe, expect, it } from 'vitest';
import { HELP_ACTIONS, HELP_SECTIONS, HelpSectionId } from './help.content';
import { ROUTE_USAGE_LIMITS, USAGE_LIMITS } from '../../../shared/limits';
import {
  POLICIES_AI_AND_PROCESSORS_FRAGMENT,
  POLICIES_CONNECTED_SERVICES_FRAGMENT,
  POLICIES_COROS_DATA_FRAGMENT,
  POLICIES_GARMIN_DATA_FRAGMENT,
  POLICIES_MCP_CLIENTS_FRAGMENT,
  POLICIES_SUUNTO_DATA_FRAGMENT,
  POLICIES_WAHOO_DATA_FRAGMENT,
} from './policies.content';

describe('help.content', () => {
  it('should expose the expected ordered section ids', () => {
    expect(HELP_SECTIONS.map(section => section.id)).toEqual<HelpSectionId[]>([
      'getting-started',
      'activity-calendar',
      'training-analysis',
      'ai-insights',
      'plans-and-billing',
      'uploads-and-imports',
      'service-connections',
      'data-and-privacy',
      'troubleshooting',
    ]);
  });

  it('should define nine unique sections with complete content', () => {
    expect(HELP_SECTIONS).toHaveLength(9);

    const uniqueIds = new Set(HELP_SECTIONS.map(section => section.id));
    expect(uniqueIds.size).toBe(HELP_SECTIONS.length);

    HELP_SECTIONS.forEach(section => {
      expect(section.title.trim().length).toBeGreaterThan(0);
      expect(section.summary.trim().length).toBeGreaterThan(0);
      expect(section.icon.trim().length).toBeGreaterThan(0);
      expect(section.content.trim().length).toBeGreaterThan(0);
      expect(section.links.length).toBeGreaterThan(0);

      section.links.forEach(link => {
        expect(link.label.trim().length).toBeGreaterThan(0);
        expect(link.icon.trim().length).toBeGreaterThan(0);
        expect(link.target.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('should document the bounded MCP-backed Assistant and external MCP alternative', () => {
    const assistantSection = HELP_SECTIONS.find(section => section.id === 'ai-insights');

    expect(assistantSection?.title).toBe('Assistant');
    expect(assistantSection?.content).toContain('Every current answer must use at least one read-only Quantified Self result');
    expect(assistantSection?.content).toContain('Expand **Data used**');
    expect(assistantSection?.content).toContain("browser's IANA timezone");
    expect(assistantSection?.content).toContain('Direct in-app URLs are withheld');
    expect(assistantSection?.content).toContain('opaque reference or cursor is rejected');
    expect(assistantSection?.content).toContain('latest six completed turns');
    expect(assistantSection?.content).toContain('refresh while an answer is in progress');
    expect(assistantSection?.content).toContain('account-bound, bounded question and request metadata');
    expect(assistantSection?.content).toContain('different signed-in account cannot restore');
    expect(assistantSection?.content).toContain('safely resends the same request ID');
    expect(assistantSection?.content).toContain('becomes unavailable about **seven days**');
    expect(assistantSection?.content).toContain('at most four extra minutes');
    expect(assistantSection?.content).toContain('deletes the expired record asynchronously');
    expect(assistantSection?.content).toContain('coordinate-free by default');
    expect(assistantSection?.content).toContain('**Precise activity locations**');
    expect(assistantSection?.content).toContain('exact activity start/end and MTB jump coordinates');
    expect(assistantSection?.content).toContain('Assistant maps have their own saved style');
    expect(assistantSection?.content).toContain('switch between Default, Satellite, and Outdoors in place');
    expect(assistantSection?.content).toContain('displayed geographic area to Mapbox');
    expect(assistantSection?.content).toContain('constructs all plotted values, coordinates, labels, and renderer settings deterministically');
    expect(assistantSection?.content).toContain('Changing this setting starts a new chat');
    expect(assistantSection?.content).toContain('route geometry');
    expect(assistantSection?.content).toContain('ranks the matching Mountain Biking activities');
    expect(assistantSection?.content).toContain('instead of comparing jump counts');
    expect(assistantSection?.content).toContain('Use [Connections -> MCP](/services?serviceName=mcp)');
    expect(assistantSection?.links).toContainEqual({
      label: 'MCP Connections',
      icon: 'devices',
      kind: 'route',
      target: '/services',
      queryParams: { serviceName: 'mcp' },
    });
  });

  it('should document the ChatGPT MCP setup path and production endpoint', () => {
    const dataAndPrivacySection = HELP_SECTIONS.find(section => section.id === 'data-and-privacy');

    expect(dataAndPrivacySection?.content).toContain('Use with ChatGPT');
    expect(dataAndPrivacySection?.content).toContain('Developer mode');
    expect(dataAndPrivacySection?.content).toContain('https://quantified-self.io/mcp');
    expect(dataAndPrivacySection?.content).toContain('recommended [256 x 256 PNG (9.4 KB)]');
    expect(dataAndPrivacySection?.content)
      .toContain('/assets/favicons/quantified-self-chatgpt-icon-256x256.png');
    expect(dataAndPrivacySection?.content).toContain('preferred minimum dimensions');
    expect(dataAndPrivacySection?.content).toContain('10 KB upload limit');
    expect(dataAndPrivacySection?.content).toContain('one-call sleep trend');
    expect(dataAndPrivacySection?.content).toContain('preferred daily report');
    expect(dataAndPrivacySection?.content).toContain('latest completed non-nap sleep');
    expect(dataAndPrivacySection?.content).toContain('average/overnight HRV');
    expect(dataAndPrivacySection?.content).toContain('average/minimum sleep heart rate');
    expect(dataAndPrivacySection?.content).toContain('current-versus-usual equivalent 28-day Training totals');
    expect(dataAndPrivacySection?.content).toContain('same live UTC-day Readiness used by Dashboard Today');
    expect(dataAndPrivacySection?.content).toContain('same-provider baseline medians');
    expect(dataAndPrivacySection?.content).toContain('processing-bounded all-history scan');
    expect(dataAndPrivacySection?.content).toContain('Oversized rankings fail');
    expect(dataAndPrivacySection?.content).toContain('jump count is not treated as jump quality');
    expect(dataAndPrivacySection?.content).toContain('missing or insufficient-baseline states');
    expect(dataAndPrivacySection?.content).toContain('today’s Readiness drivers');
    expect(dataAndPrivacySection?.content).toContain('daily report with sleep HRV and sleep heart rate');
    expect(dataAndPrivacySection?.content).toContain('[**Connections -> MCP**](/services?serviceName=mcp)');
    expect(dataAndPrivacySection?.content).toContain('### Android authorization handoff');
    expect(dataAndPrivacySection?.content).toContain('**Open supported links**');
    expect(dataAndPrivacySection?.content).toContain('cannot force Android or the ChatGPT app');
    expect(dataAndPrivacySection?.content).toContain('[Read-only MCP Server feature page](/features/mcp-server)');
    expect(dataAndPrivacySection?.content).toContain('[Privacy Policy](/privacy)');
    expect(dataAndPrivacySection?.content).toContain('[Terms of Service](/terms)');
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'MCP Server',
      icon: 'devices',
      kind: 'route',
      target: '/features/mcp-server',
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'MCP Connections',
      icon: 'devices',
      kind: 'route',
      target: '/services',
      queryParams: { serviceName: 'mcp' },
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'Privacy Policy',
      icon: 'lock_outline',
      kind: 'route',
      target: '/privacy',
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'Terms of Service',
      icon: 'gavel',
      kind: 'route',
      target: '/terms',
    });
  });

  it('should expose four unique global support actions', () => {
    expect(HELP_ACTIONS).toHaveLength(4);

    const uniqueIds = new Set(HELP_ACTIONS.map(action => action.id));
    expect(uniqueIds.size).toBe(HELP_ACTIONS.length);

    HELP_ACTIONS.forEach(action => {
      expect(action.label.trim().length).toBeGreaterThan(0);
      expect(action.icon.trim().length).toBeGreaterThan(0);
      expect(action.target.trim().length).toBeGreaterThan(0);
    });
  });

  it('should document the dashboard recovery tile now/active/latest summary behavior', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Recovery left');
    expect(gettingStartedSection?.content).toContain('Active total');
    expect(gettingStartedSection?.content).toContain('Latest workout');
    expect(gettingStartedSection?.content).toContain('updating');
  });

  it('should document the Dashboard Today recovery countdown behavior', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('estimated local finish time as Training');
    expect(gettingStartedSection?.content).toContain('disappears when elapsed');
  });

  it('should document dashboard manager curated/custom/map categories', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Dashboard manager');
    expect(gettingStartedSection?.content).toContain('Manual');
    expect(gettingStartedSection?.content).toContain('Presets');
    expect(gettingStartedSection?.content).toContain('Curated');
    expect(gettingStartedSection?.content).toContain('KPI');
    expect(gettingStartedSection?.content).toContain('Custom');
    expect(gettingStartedSection?.content).toContain('Map');
    expect(gettingStartedSection?.content).toContain('one activity map and one saved-routes map');
    expect(gettingStartedSection?.content).toContain('Event search filters only the dashboard event table');
    expect(gettingStartedSection?.content).toContain('Event tags can be added from an event row or event details');
    expect(gettingStartedSection?.content).toContain('exact tag filter');
    expect(gettingStartedSection?.content).toContain('up to 250 selected events');
    expect(gettingStartedSection?.content).toContain('atomic add/remove tag changes in bulk');
    expect(gettingStartedSection?.content).toContain('tags are visible on public event and comparison links');
    expect(gettingStartedSection?.content).toContain('Custom** charts use their own tile date-range and activity filters');
    expect(gettingStartedSection?.content).toContain('Map** tiles can use activity events or saved route previews');
    expect(gettingStartedSection?.content).toContain('Routes** map tiles show recent saved routes from lightweight route previews');
    expect(gettingStartedSection?.content).toContain('derived tiles stay independent from event table filters and custom/map tile filters');
    expect(gettingStartedSection?.content).toContain('New dashboards start with the Activity Calendar tile');
    expect(gettingStartedSection?.content).toContain('default 1 x 1 dashboard tile');
    expect(gettingStartedSection?.content).toContain('one-time addition to existing dashboards that lack it');
    expect(gettingStartedSection?.content).toContain('Open Training');
    expect(gettingStartedSection?.content).toContain('Select its calendar icon to open a mini calendar for the current month');
    expect(gettingStartedSection?.content).toContain('baseline comparisons');
    expect(gettingStartedSection?.content).not.toContain('Simplify dashboard');
    expect(gettingStartedSection?.content).toContain('Beyond the default Activity Calendar');
    expect(gettingStartedSection?.content).toContain('[Activity Calendar guide](/help#activity-calendar)');
    expect(gettingStartedSection?.content).toContain('It can add a **Routes** map once saved routes have generated previews');
    expect(gettingStartedSection?.content).toContain('**Reset to default**');
    expect(gettingStartedSection?.content).toContain('replaces the current dashboard tiles');
    expect(gettingStartedSection?.content).toContain('**Add everything**');
    expect(gettingStartedSection?.content).toContain('**Uploaded activities**');
    expect(gettingStartedSection?.content).toContain('**Training** remains the fixed analytical workspace');
    expect(gettingStartedSection?.content).toContain('**Aerobic Capacity**');
    expect(gettingStartedSection?.content).toContain('**Aerobic Durability**');
    expect(gettingStartedSection?.content).toContain('current **Readiness**');
    expect(gettingStartedSection?.content).toContain('groups chart and map tiles by intent');
    expect(gettingStartedSection?.content).toContain('**Activity Overview**, **Routes & Maps**, and **Custom Charts**');
    expect(gettingStartedSection?.content).toContain('Custom charts are placed in those dashboard sections automatically');
    expect(gettingStartedSection?.content).toContain('chart-aware default sizes');
    expect(gettingStartedSection?.content).toContain('Empty editable dashboards show lightweight section guidance');
    expect(gettingStartedSection?.content).toContain('**Cycling Power Curve** and **Running Power Curve** are curated derived snapshots');
    expect(gettingStartedSection?.content).toContain('defaults to **1y**');
    expect(gettingStartedSection?.content).toContain('latest activity or a saved recent-best comparison window');
  });

  it('should provide a dedicated Activity Calendar guide', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');
    const calendarSection = HELP_SECTIONS.find(section => section.id === 'activity-calendar');

    expect(calendarSection?.content).toContain('**Week**, **Month**, and **Year** views');
    expect(calendarSection?.content).toContain('1 x 1 **Activity Calendar** tile');
    expect(calendarSection?.content).toContain('Dashboard and Training headers each include a **Calendar** action');
    expect(calendarSection?.content).toContain('Existing editable dashboards that do not contain the Activity Calendar receive it once automatically');
    expect(calendarSection?.content).toContain('Dashboard manager **Remove all** to keep it from returning');
    expect(calendarSection?.content).toContain('place multiple circles concentrically around the same center');
    expect(calendarSection?.content).toContain('size reflects recorded duration');
    expect(calendarSection?.content).toContain('individual activities with their available distance and elevation metrics');
    expect(calendarSection?.content).toContain('intentionally have no hover or touch tooltip');
    expect(calendarSection?.content).toContain('recorded **Distance**, **Duration**, and **Ascent**');
    expect(calendarSection?.content).toContain('Month totals exclude adjacent dates');
    expect(calendarSection?.content).toContain('scaled against the longest-duration group');
    expect(calendarSection?.content).toContain('alpine skiing, snowboarding, and downhill cycling');
    expect(calendarSection?.content).toContain('do not add ascent but do contribute descent');
    expect(calendarSection?.content).toContain('summary exclusions configured in **Settings** also apply');
    expect(calendarSection?.content).toContain('Settings -> Dashboard -> Start of the Week');
    expect(calendarSection?.content).toContain('visible-period activity query');
    expect(calendarSection?.content).toContain('independent from the dashboard event table');
    expect(calendarSection?.content).toContain('Merge and benchmark records are excluded');
    expect(calendarSection?.content).toContain('action menu to share, reprocess, download, or delete it');
    expect(calendarSection?.links).toContainEqual({
      label: 'Activity Calendar Overview',
      icon: 'travel_explore',
      kind: 'route',
      target: '/features/activity-calendar',
    });
    expect(gettingStartedSection?.links).toContainEqual({
      label: 'Activity Calendar guide',
      icon: 'school',
      kind: 'route',
      target: '/help',
      fragment: 'activity-calendar',
    });
  });

  it('should document safe event merge retry and recovery behavior', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');
    const troubleshootingSection = HELP_SECTIONS.find(section => section.id === 'troubleshooting');

    expect(gettingStartedSection?.content)
      .toContain('reuses the same merged result instead of creating a duplicate');
    expect(troubleshootingSection?.content).toContain('merge may still be finishing');
    expect(troubleshootingSection?.content).toContain('selected rows remain selected');
    expect(troubleshootingSection?.content).toContain('safely reuses any existing result');
  });

  it('should provide a dedicated Training analysis guide with evidence and missing-data rules', () => {
    const trainingSection = HELP_SECTIONS.find(section => section.id === 'training-analysis');

    expect(trainingSection?.content).toContain('What drove this');
    expect(trainingSection?.content).toContain('compact line above the **Training** title');
    expect(trainingSection?.content).toContain('content does not shift');
    expect(trainingSection?.content).toContain('failed update adds **Retry**');
    expect(trainingSection?.content).toContain('**Largest sport load change**');
    expect(trainingSection?.content).toContain('do not mean that the workspace is filtered');
    expect(trainingSection?.content).toContain('neutral higher/lower language');
    expect(trainingSection?.content).toContain('plots a readable 12-week durability trend');
    expect(trainingSection?.content).toContain('**Body-weight trend**');
    expect(trainingSection?.content).toContain('appears last on Training as secondary, neutral context');
    expect(trainingSection?.content).toContain('multiple measurements on one UTC day to a median');
    expect(trainingSection?.content).toContain('does not change the Training state, Form, Readiness');
    expect(trainingSection?.content).toContain('A Cycling Power Curve proves that power was recorded');
    expect(trainingSection?.content).toContain('**Power systems** is available to every signed-in Training user');
    expect(trainingSection?.content).toContain('It estimates current CP, W′, and Pmax');
    expect(trainingSection?.content).toContain('preceding 42 completed UTC days');
    expect(trainingSection?.content).toContain('smaller set of workouts that actually supplied');
    expect(trainingSection?.content).toContain('A type selector appears only when more than one exact activity type is available');
    expect(trainingSection?.content).toContain('fitting-method disagreement');
    expect(trainingSection?.content).toContain('stable CP can remain visible when W′ is unstable');
    expect(trainingSection?.content).toContain('**What this means**');
    expect(trainingSection?.content).toContain('competing W′ estimate range');
    expect(trainingSection?.content).toContain('whole-workout removal');
    expect(trainingSection?.content).toContain('New power curves remove isolated one-sample recording artifacts');
    expect(trainingSection?.content).toContain('short-curve signature in older stored curves');
    expect(trainingSection?.content).toContain('Parsing a workout no longer generates CP, W′, Pmax, or power-system strain');
    expect(trainingSection?.content).toContain('original continuous power stream');
    expect(trainingSection?.content).not.toContain('asks for reprocessing');
    expect(trainingSection?.content).toContain('Weeks without a comparable session explain their primary exclusions');
    expect(trainingSection?.content).toContain('intentional easing, terrain changes, coasting, or a pace change');
    expect(trainingSection?.content).toContain('no suitable comparison rather than zero');
    expect(trainingSection?.content).toContain('**All sports**');
    expect(trainingSection?.content).toContain('compact swipeable sport buttons');
    expect(trainingSection?.content).toContain('compact **All sports** arrow button opens every sport');
    expect(trainingSection?.content).toContain('**Manage sport shortcuts**');
    expect(trainingSection?.content).toContain('training duration and workouts in the latest 28 days');
    expect(trainingSection?.content).toContain('selected shortcut does not jump');
    expect(trainingSection?.content).toContain('Running, Cycling, Swimming, Rowing, Walking & Hiking, Nordic Skiing, Strength, or Paddling');
    expect(trainingSection?.content).toContain('Shortcuts change navigation only');
    expect(trainingSection?.content).toContain('**Use automatic selection**');
    expect(trainingSection?.content).toContain('unmatched types appear under **Other power activities**');
    expect(trainingSection?.content).toContain('standard mountain biking, Enduro MTB, and Downhill MTB');
    expect(trainingSection?.content).toContain('does not invent downhill runs or uplift/lift segments');
    expect(trainingSection?.content).toContain('Longest jump is the maximum persisted jump distance');
    expect(trainingSection?.content).toContain('gravity MTB jump count and longest jump');
    expect(trainingSection?.content).toContain('Rowing does not have a durability adapter');
    expect(trainingSection?.content).toContain('fixed Cycling power context remains visible');
    expect(trainingSection?.content).toContain('power unknown rather than confirmed no power');
    expect(trainingSection?.content).toContain('Unsupported Enduro and Downhill evidence is not counted as confirmed power');
    expect(trainingSection?.content).toContain('one activity leg at a time');
    expect(trainingSection?.content).toContain('shown first as quick picks');
    expect(trainingSection?.content).toContain('selecting an event never changes its tags');
    expect(trainingSection?.content).toContain('**Recovery context**');
    expect(trainingSection?.content).toContain('**Recovery left**');
    expect(trainingSection?.content).toContain('**Sleep history**');
    expect(trainingSection?.content).toContain('remains visible while sleep details are collapsed');
    expect(trainingSection?.content).toContain('estimated local finish time');
    expect(trainingSection?.content).toContain('**Show sleep details**');
    expect(trainingSection?.content).toContain('omitted quietly when missing or elapsed');
    expect(trainingSection?.content).toContain('without changing the Training state');
    expect(trainingSection?.content).toContain('Dashboard **Today** shows the same compact state label and caption');
    expect(trainingSection?.content).toContain('same current formula as Dashboard Today');
    expect(trainingSection?.content).toContain('Average HR leads the single Overnight HR driver at 70%, minimum HR contributes 30%');
    expect(trainingSection?.content).toContain('Lower Overnight HR versus personal baseline supports readiness');
    expect(trainingSection?.content).toContain('can provide both HR measures');
    expect(trainingSection?.content).toContain('Garmin Health sleep summaries currently provide neither');
    expect(trainingSection?.content).toContain('bounded 30-day sleep-only query');
    expect(trainingSection?.content).toContain('does not load event or activity history');
    expect(trainingSection?.content).toContain('Failed load or sleep reads are identified separately');
    expect(trainingSection?.content).toContain('Sleep already loaded before a listener failure remains visible only while eligible');
    expect(trainingSection?.content).toContain('context, not a workout instruction');
    expect(trainingSection?.content).toContain('**14-day trend**');
    expect(trainingSection?.content).toContain('without scanning activity history');
    expect(trainingSection?.content).toContain('each daily point applies its own 30-day sleep window');
    expect(trainingSection?.content).toContain('missing scores stay as gaps');
    expect(trainingSection?.content).toContain('longest valid main overnight record');
    expect(trainingSection?.content).toContain('at least three recorded nights');
    expect(trainingSection?.content).toContain('at least five qualifying nights');
    expect(trainingSection?.content).toContain('Missing nights and missing HRV are never counted as zero');
    expect(trainingSection?.content).toContain('at least seven recorded nights and at least half of the window');
    expect(trainingSection?.content).toContain('keeps pool and open-water evidence separate');
    expect(trainingSection?.content).toContain('does not infer Critical Swim Speed');
    expect(trainingSection?.content).toContain('zero-session result');
    expect(trainingSection?.content).toContain('Imported VO₂ max');
    expect(trainingSection?.content).toContain("95% of that activity's 20-minute best");
    expect(trainingSection?.content).toContain('There is no pooled all-sports value');
    expect(trainingSection?.content).toContain('partial, insufficient, poor-fit, unstable, and invalid evidence');
    expect(trainingSection?.content).not.toContain('aggregate best 3–20 minute power curve');
    expect(trainingSection?.content).toContain('never a readiness score');
    expect(trainingSection?.links).toContainEqual({
      label: 'Open Training',
      icon: 'monitoring',
      kind: 'route',
      target: '/training',
    });
  });

  it('should link Getting Started to Training guidance and feedback', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');
    const trainingSection = HELP_SECTIONS.find(section => section.id === 'training-analysis');

    expect(gettingStartedSection?.content).toContain('**Training** is your fixed workspace');
    expect(gettingStartedSection?.content).toContain('[Training analysis guide](/help#training-analysis)');
    expect(gettingStartedSection?.content).toContain('[Training Analysis overview](/features/training-analysis)');
    expect(gettingStartedSection?.content).toContain('**Feedback** action to email support');
    expect(gettingStartedSection?.content).not.toContain('**Training (Beta)**');
    expect(gettingStartedSection?.links).toContainEqual({
      label: 'Training analysis guide',
      icon: 'school',
      kind: 'route',
      target: '/help',
      fragment: 'training-analysis',
    });
    expect(gettingStartedSection?.links).toContainEqual({
      label: 'Training Analysis Overview',
      icon: 'monitoring',
      kind: 'route',
      target: '/features/training-analysis',
    });
    expect(trainingSection?.links).toContainEqual({
      label: 'Email Training Feedback',
      icon: 'email',
      kind: 'external',
      target: expect.stringMatching(/^mailto:.*subject=Training%20feedback$/),
    });
  });

  it('should document that distance values follow unit preferences across the app', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Distance values in dashboards, event charts, activity chips, and CSV exports');
    expect(gettingStartedSection?.content).toContain('Dashboard **Action prompts**');
    expect(gettingStartedSection?.content).toContain('dashboard **Default units** action prompt');
    expect(gettingStartedSection?.content).toContain('**No activities yet**');
    expect(gettingStartedSection?.content).toContain('**Upload activity**');
    expect(gettingStartedSection?.content).toContain('**Connect service**');
    expect(gettingStartedSection?.content).toContain('FIT, GPX, TCX, JSON, and SML files');
    expect(gettingStartedSection?.content).toContain('Garmin, Suunto, COROS, and Wahoo');
    expect(gettingStartedSection?.content).toContain('after activity data exists');
    expect(gettingStartedSection?.content).toContain('Pro users with activity data but without a connected activity service');
    expect(gettingStartedSection?.content).toContain('**Connect a service** action prompt');
    expect(gettingStartedSection?.content).toContain('dismissing it hides the prompt permanently');
    expect(gettingStartedSection?.content).toContain('**Send new activities to Suunto** action prompt');
    expect(gettingStartedSection?.content).toContain('Turning it on affects new Garmin or COROS activities only');
    expect(gettingStartedSection?.content).toContain('use **Sync past activities** in **Services** for activities already in Quantified Self');
    expect(gettingStartedSection?.content).toContain('Advanced settings');
    expect(gettingStartedSection?.content).toContain('kilometers or miles');
    expect(gettingStartedSection?.content).toContain('Settings -> Units');
    expect(gettingStartedSection?.content).toContain('jump distances display in feet when miles are selected');
  });

  it('should document event swim length tables', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Event swim length tables');
    expect(gettingStartedSection?.content).toContain('**Swim Lengths** table');
    expect(gettingStartedSection?.content).toContain('per-length pool data');
    expect(gettingStartedSection?.content).toContain('grouped into collapsed sets through the next idle/rest length');
    expect(gettingStartedSection?.content).toContain('lap index, split progress, duration, distance, length type, stroke, strokes, swim pace, cadence, heart rate, SWOLF, and energy');
    expect(gettingStartedSection?.content).toContain('25 m, 50 m, 75 m, and 100 m splits before the rest row');
  });

  it('should document sport-specific event lap table columns', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Event lap tables');
    expect(gettingStartedSection?.content).toContain('**Laps -> Columns**');
    expect(gettingStartedSection?.content).toContain('typed metric search');
    expect(gettingStartedSection?.content).toContain('Running, Cycling, Swimming, or Other activities');
    expect(gettingStartedSection?.content).toContain('separate column list for each of those sport families');
    expect(gettingStartedSection?.content).toContain('Running and trail-running laps use pace');
    expect(gettingStartedSection?.content).toContain('Each lap table includes an **Avg** row directly below its headers');
    expect(gettingStartedSection?.content).toContain('Accumulated totals, such as duration, distance, elevation, energy, and work, are not averaged');
    expect(gettingStartedSection?.content).toContain('Satellite diagnostics and EHPE/EVPE position-error metrics');
    expect(gettingStartedSection?.content).toContain('Missing values stay unavailable rather than becoming zero');
  });

  it('should document event stamina metrics', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Event stamina metrics');
    expect(gettingStartedSection?.content).toContain('**Stamina** and **Potential Stamina**');
    expect(gettingStartedSection?.content).toContain('Detailed Statistics');
    expect(gettingStartedSection?.content).toContain('event summary metric tabs');
    expect(gettingStartedSection?.content).toContain('selectable chart metrics');
    expect(gettingStartedSection?.content).toContain('**Beginning Potential Stamina**');
    expect(gettingStartedSection?.content).toContain('**Ending Potential Stamina**');
  });

  it('should document event dive profiles, depth availability, and units', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Event dive profiles');
    expect(gettingStartedSection?.content).toContain('Diving, Scuba Diving, Free Diving, Snorkeling, and Mermaiding');
    expect(gettingStartedSection?.content).toContain('**Dive Profile**');
    expect(gettingStartedSection?.content).toContain('below Performance Charts and above the normal Event Details charts');
    expect(gettingStartedSection?.content).toContain('standard Event Details chart controls and height');
    expect(gettingStartedSection?.content).toContain('standard chart overlay picker');
    expect(gettingStartedSection?.content).toContain('**Maximum Depth**');
    expect(gettingStartedSection?.content).toContain('both the Overall and Environment event-summary metrics');
    expect(gettingStartedSection?.content).toContain('advanced chart metric');
    expect(gettingStartedSection?.content).toContain('first Swim pace preference');
  });

  it('should document duration fallback for any activity without distance data', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('if any selected activity does not include distance data');
  });

  it('should document non-merged event heart-rate and power zone line and fill coloring', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('provider heart-rate or power zone boundaries');
    expect(gettingStartedSection?.content).toContain('non-merged events');
    expect(gettingStartedSection?.content).toContain('**Reset zoom or selection** button');
    expect(gettingStartedSection?.content).toContain('clears the shared chart state for the event');
    expect(gettingStartedSection?.content).toContain('Each event chart panel can use the **Overlay** button');
    expect(gettingStartedSection?.content).toContain('Right-clicking an event chart copies a themed image of the full chart panel');
    expect(gettingStartedSection?.content).toContain('**Show Swim Lengths** chart option');
    expect(gettingStartedSection?.content).toContain('swim length end boundaries');
    expect(gettingStartedSection?.content).toContain('active and idle/rest lengths are both included');
    expect(gettingStartedSection?.content).toContain('shared y-axis');
    expect(gettingStartedSection?.content).toContain('right-side y-axis');
    expect(gettingStartedSection?.content).toContain('saved globally by primary metric');
    expect(gettingStartedSection?.content).toContain('primary metric keeps its normal line and fill');
    expect(gettingStartedSection?.content).toContain('plain solid no-fill line using the overlay metric');
    expect(gettingStartedSection?.content).toContain('merged and benchmark events');
    expect(gettingStartedSection?.content).toContain('both metric and activity labels');
    expect(gettingStartedSection?.content).toContain('[Features hub](/features)');
    expect(gettingStartedSection?.content).toContain('[Workout Data Comparison](/features/workout-data-comparison)');
    expect(gettingStartedSection?.content).toContain('[Workout File Comparison](/features/workout-file-comparison)');
    expect(gettingStartedSection?.content).toContain('[Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer)');
    expect(gettingStartedSection?.content).toContain('[FIT and GPX Route Files](/features/fit-gpx-route-files)');
    expect(gettingStartedSection?.content).toContain('[Sports Watch Benchmark](/features/sports-watch-benchmark)');
    expect(gettingStartedSection?.content).toContain('[File Comparison Tool](/tools/compare)');
    expect(gettingStartedSection?.content).toContain('[Tools -> Compare](/tools/compare/saved)');
    expect(gettingStartedSection?.content).toContain('sortable, filterable, paginated table with device, activity type, and review tag filters, selected-row bulk delete, distance, ascent, descent, visible benchmark pairs, GNSS/heart-rate/altitude benchmark error metrics colored by low/moderate/high error, clickable draft metric cells that open the benchmark flow, quick description notes, and custom reviewer tags');
    expect(gettingStartedSection?.content).toContain('Benchmark reports show an **At a Glance** reviewer summary');
    expect(gettingStartedSection?.content).toContain('report share menu can copy that summary');
    expect(gettingStartedSection?.content).toContain('account-level device color preferences from saved file comparisons');
    expect(gettingStartedSection?.content).toContain('keyed by the base device name rather than firmware/software version');
    expect(gettingStartedSection?.content).toContain('activity toggles, event tables, benchmark dialogs, charts, and maps');
    expect(gettingStartedSection?.content).toContain('uploaded FIT/TCX/GPX/JSON/SML activity files');
    expect(gettingStartedSection?.content).toContain('maps, charts');
    expect(gettingStartedSection?.content).toContain('reviewer workflows for device tests, YouTube videos, and blog posts');
    expect(gettingStartedSection?.content).toContain(`Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes`);
    expect(gettingStartedSection?.content).toContain('automatic provider sync and higher limits require a paid plan');
    expect(gettingStartedSection?.content).not.toContain('overlays, AI insights, and reviewer workflows');
    expect(gettingStartedSection?.content).toContain('**Altitude** charts can color the altitude line by grade');
    expect(gettingStartedSection?.content).toContain('**Color Altitude by Grade**');
    expect(gettingStartedSection?.content).toContain('**Heart Rate** and **Power** charts color their lines and visible fill');
    expect(gettingStartedSection?.content).toContain('**Include all recorded metrics**');
    expect(gettingStartedSection?.content).toContain('available in **Visible charts**');
    expect(gettingStartedSection?.content).toContain('does not change which charts are currently visible');
    expect(gettingStartedSection?.content).not.toContain('lightly tints the chart grid by zone');
  });

  it('should document the dashboard form tile CTL/ATL/TSB behavior', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Form tile (CTL / ATL / TSB)');
    expect(gettingStartedSection?.content).toContain('Training Stress Score');
    expect(gettingStartedSection?.content).toContain('Power Training Stress Score');
    expect(gettingStartedSection?.content).toContain('Current TSB');
    expect(gettingStartedSection?.content).toContain('same-day readiness');
    expect(gettingStartedSection?.content).toContain('full history');
    expect(gettingStartedSection?.content).toContain('W / M / Y');
    expect(gettingStartedSection?.content).toContain('saved on that dashboard tile');
    expect(gettingStartedSection?.content).toContain('continue to **today** with zero-load decay');
    expect(gettingStartedSection?.content).toContain('does not use slider or reload/reset toolbar controls');
    expect(gettingStartedSection?.content).toContain('Latest workout TSS');
    expect(gettingStartedSection?.content).toContain('weekly');
    expect(gettingStartedSection?.content).toContain('asynchronously');
    expect(gettingStartedSection?.content).toContain('top summary-header slot');
    expect(gettingStartedSection?.content).toContain('before **Today** and the tiles');
  });

  it('should document new derived KPI rows and curated charts', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Freshness Forecast');
    expect(gettingStartedSection?.content).toContain('Intensity Distribution');
    expect(gettingStartedSection?.content).toContain('Efficiency Trend');
    expect(gettingStartedSection?.content).toContain('Cycling Power Curve');
    expect(gettingStartedSection?.content).toContain('Running Power Curve');
    expect(gettingStartedSection?.content).toContain('prepared PowerCurve snapshot');
    expect(gettingStartedSection?.content).toContain('latest activity, best last 30d, or best last 90d');
    expect(gettingStartedSection?.content).toContain('Cycling and running power data stay in separate tiles');
    expect(gettingStartedSection?.content).toContain('saved per dashboard tile');
    expect(gettingStartedSection?.content).not.toContain('**Sleep** shows connected-source sleep duration');
    expect(gettingStartedSection?.content).toContain('ACWR');
    expect(gettingStartedSection?.content).toContain('Ramp Rate');
    expect(gettingStartedSection?.content).toContain('Monotony / Strain');
    expect(gettingStartedSection?.content).toContain('Load Status');
    expect(gettingStartedSection?.content).toContain('Form Now');
    expect(gettingStartedSection?.content).toContain('Fitness (CTL)');
    expect(gettingStartedSection?.content).toContain('Fatigue (ATL)');
    expect(gettingStartedSection?.content).toContain('Fitness Trend');
    expect(gettingStartedSection?.content).toContain('Fatigue Trend');
    expect(gettingStartedSection?.content).toContain('Recovery Debt');
    expect(gettingStartedSection?.content).toContain('Form +7d');
    expect(gettingStartedSection?.content).toContain('Training Balance');
    expect(gettingStartedSection?.content).toContain('Easy %');
    expect(gettingStartedSection?.content).toContain('Hard %');
    expect(gettingStartedSection?.content).toContain('Efficiency Δ (4w)');
    expect(gettingStartedSection?.content).toContain('Load');
    expect(gettingStartedSection?.content).toContain('Readiness');
    expect(gettingStartedSection?.content).toContain('same compact **Training state** label and caption as Training');
    expect(gettingStartedSection?.content).toContain('Execution');
    expect(gettingStartedSection?.content).toContain('Current week');
    expect(gettingStartedSection?.content).toContain('Latest week');
    expect(gettingStartedSection?.content).toContain('8w / 12w / 6m / 1y / All');
    expect(gettingStartedSection?.content).toContain('Training-derived tiles do not fall back');
    expect(gettingStartedSection?.content).toContain('**info** icon');
    expect(gettingStartedSection?.content).toContain('Dashboard **Today** header');
    expect(gettingStartedSection?.content).toContain('browser-local morning, afternoon, or evening time');
    expect(gettingStartedSection?.content).toContain('generic copy otherwise');
    expect(gettingStartedSection?.content).toContain('hidden on shared dashboards');
    expect(gettingStartedSection?.content).toContain('**Show Today summary**');
    expect(gettingStartedSection?.content).toContain('hides the Today summary');
    expect(gettingStartedSection?.content).toContain('Today rows stay compact');
    expect(gettingStartedSection?.content).toContain('KPI detail rows');
    expect(gettingStartedSection?.content).toContain('freshness date');
    expect(gettingStartedSection?.content).toContain('metric-specific');
  });

  it('should document mobile dashboard haptic feedback behavior and fallback', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('haptic feedback');
    expect(gettingStartedSection?.content).toContain('supported mobile devices');
    expect(gettingStartedSection?.content).toContain('vibration support is unavailable');
    expect(gettingStartedSection?.content).toContain('reduced-motion is enabled');
  });

  it('should document selected-row GPX export options', () => {
    const uploadsSection = HELP_SECTIONS.find(section => section.id === 'uploads-and-imports');

    expect(uploadsSection?.content).toContain('CSV export, GPX export, and original-file download actions support your current multi-selection');
    expect(uploadsSection?.content).toContain('multi-selected GPX exports download as a ZIP');
  });

  it('should document how to send saved routes to Garmin', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');

    expect(serviceConnectionsSection?.content).toContain('saved-route row and bulk sends');
    expect(serviceConnectionsSection?.content).toContain('available to every signed-in account');
    expect(serviceConnectionsSection?.content).toContain('marked **PRO**');
    expect(serviceConnectionsSection?.content).toContain('MCP is marked **FREE**');
    expect(serviceConnectionsSection?.content).toContain('can always be disconnected');
    expect(serviceConnectionsSection?.content).toContain('an automated subscription check disconnects');
    expect(serviceConnectionsSection?.content).toContain('Services opens each provider on a compact connection overview');
    expect(serviceConnectionsSection?.content).toContain('Choose an action');
    expect(serviceConnectionsSection?.content).toContain('provider tool in a dialog');
    expect(serviceConnectionsSection?.content).toContain('unchanged overview');
    expect(serviceConnectionsSection?.content).toContain('**Your data flow**');
    expect(serviceConnectionsSection?.content).toContain('With no services connected');
    expect(serviceConnectionsSection?.content).toContain('provider-to-provider matrix');
    expect(serviceConnectionsSection?.content).toContain('On phones, the same routes are grouped by source and destination');
    expect(serviceConnectionsSection?.content).toContain('**Needs connection**');
    expect(serviceConnectionsSection?.content).toContain('Saved FIT and GPX routes can also be sent to Garmin Connect from **Routes**');
    expect(serviceConnectionsSection?.content).toContain('**Course Import** permission');
    expect(serviceConnectionsSection?.content).toContain('Routes can show a Garmin permission prompt');
    expect(serviceConnectionsSection?.content).toContain('updates the same Garmin course when you send that route again to the same Garmin account');
    expect(serviceConnectionsSection?.content).toContain('**Uploads** in Garmin Services accepts selected GPX and FIT route files');
    expect(serviceConnectionsSection?.content).toContain('uploading the same file again creates another Garmin course');
  });

  it('should document automatic and one-time Suunto route sending to Garmin', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');

    expect(serviceConnectionsSection?.content).toContain('**Automatically send new and updated routes**');
    expect(serviceConnectionsSection?.content).toContain('the limited COROS route pilot');
    expect(serviceConnectionsSection?.content).toContain('one-time **Routes** page prompt');
    expect(serviceConnectionsSection?.content).toContain('newly imported or updated Suunto routes already saved in Quantified Self');
    expect(serviceConnectionsSection?.content).toContain('requires **Course Import** permission');
    expect(serviceConnectionsSection?.content).toContain('**Send routes** uses Suunto routes already saved in Quantified Self');
    expect(serviceConnectionsSection?.content).toContain('does not fetch routes from Suunto or any destination');
    expect(serviceConnectionsSection?.content).toContain('[Suunto routes to Garmin courses guide](/guides/sync-suunto-routes-to-garmin-courses)');
    expect(serviceConnectionsSection?.links?.some(link => link.target === '/guides/sync-suunto-routes-to-garmin-courses')).toBe(true);
  });

  it('should document opt-in Suunto saved-route delivery to Wahoo', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');

    expect(serviceConnectionsSection?.content).toContain('Suunto Services for Garmin or Wahoo; approved COROS route-pilot accounts also see COROS');
    expect(serviceConnectionsSection?.content).toContain('Wahoo receives a FIT course');
    expect(serviceConnectionsSection?.content).toContain('updated Suunto route replaces its earlier Wahoo route instead of creating a duplicate');
    expect(serviceConnectionsSection?.content).toContain('automatically send new and updated Suunto routes already saved in Quantified Self to Wahoo');
    expect(serviceConnectionsSection?.content).toContain('Suunto-to-Wahoo saved-route delivery is a separate, opt-in route workflow in Suunto Services');
  });

  it('should document activity and route limits in plans and uploads help', () => {
    const plansSection = HELP_SECTIONS.find(section => section.id === 'plans-and-billing');
    const uploadsSection = HELP_SECTIONS.find(section => section.id === 'uploads-and-imports');

    expect(plansSection?.content).toContain(`Up to **${USAGE_LIMITS.free} activities**`);
    expect(plansSection?.content).toContain(`Up to **${ROUTE_USAGE_LIMITS.free} saved routes**`);
    expect(plansSection?.content).toContain(`Up to **${USAGE_LIMITS.basic.toLocaleString('en-US')} activities**`);
    expect(plansSection?.content).toContain(`Up to **${ROUTE_USAGE_LIMITS.basic} saved routes**`);
    expect(plansSection?.content).toContain('**Unlimited saved routes**');
    expect(plansSection?.content).toContain('public pricing page shows the exact trial length as an offer for eligible new members');
    expect(plansSection?.content).toContain('Trial eligibility is confirmed after sign-in');
    expect(plansSection?.content).toContain('Existing activities and routes are retained. New uploads follow your current plan limits.');
    expect(uploadsSection?.content).toContain(`**Starter** includes up to **${ROUTE_USAGE_LIMITS.free} saved routes**`);
    expect(uploadsSection?.content).toContain(`**Basic** includes up to **${ROUTE_USAGE_LIMITS.basic} saved routes**`);
    expect(uploadsSection?.content).toContain("You may have reached your current plan's activity or route limit.");
    expect(uploadsSection?.content).toContain('[FIT and GPX Route Files](/features/fit-gpx-route-files)');
    expect(uploadsSection?.content).toContain('Saved routes open from **Routes** with the details action.');
    expect(uploadsSection?.content).toContain('waypoints and turn instructions');
    expect(uploadsSection?.content).toContain('parsed points and streams are not saved back to Firestore');
    expect(uploadsSection?.content).toContain('lightweight encoded route preview for route-table thumbnails, the Routes page map, and dashboard route maps');
    expect(uploadsSection?.content).toContain('Routes page map follows the current table filters using saved-route documents only');
    expect(uploadsSection?.content).toContain('does not load activity events or parse original route files');
    expect(uploadsSection?.content).toContain('Older saved routes need to be reprocessed before they appear with previews');
    expect(uploadsSection?.links).toContainEqual({
      label: 'FIT and GPX Route Files',
      icon: 'route',
      kind: 'route',
      target: '/features/fit-gpx-route-files',
    });
  });

  it('should document shared activity and route delivery with COROS in plain language', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');

    expect(serviceConnectionsSection?.content).toContain('Integrations hub');
    expect(serviceConnectionsSection?.content).toContain('/integrations');
    expect(serviceConnectionsSection?.content).toContain('[Training Data Sync Guides](/guides)');
    expect(serviceConnectionsSection?.content).toContain('[Tools hub](/tools)');
    expect(serviceConnectionsSection?.content).toContain('[File Comparison Tool](/tools/compare)');
    expect(serviceConnectionsSection?.content).toContain('[Features hub](/features)');
    expect(serviceConnectionsSection?.content).toContain('[Workout Data Comparison](/features/workout-data-comparison)');
    expect(serviceConnectionsSection?.content).toContain('[Workout File Comparison](/features/workout-file-comparison)');
    expect(serviceConnectionsSection?.content).toContain('[Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer)');
    expect(serviceConnectionsSection?.content).toContain('[FIT and GPX Route Files](/features/fit-gpx-route-files)');
    expect(serviceConnectionsSection?.content).toContain('[Sports Watch Benchmark](/features/sports-watch-benchmark)');
    expect(serviceConnectionsSection?.content).toContain('[Garmin to Suunto sync guide](/guides/sync-garmin-to-suunto)');
    expect(serviceConnectionsSection?.content).toContain('[COROS to Suunto sync guide](/guides/sync-coros-to-suunto)');
    expect(serviceConnectionsSection?.content).toContain('[Wahoo to Suunto sync guide](/guides/sync-wahoo-to-suunto)');
    expect(serviceConnectionsSection?.content).toContain('[import activities to Suunto guide](/guides/import-activities-to-suunto)');
    expect(serviceConnectionsSection?.content).toContain('[import activities to Wahoo guide](/guides/import-activities-to-wahoo)');
    expect(serviceConnectionsSection?.content).toContain('[centralized workout data guide](/guides/centralize-garmin-suunto-coros-workout-data)');
    expect(serviceConnectionsSection?.content).toContain('uploaded FIT/TCX/GPX/JSON/SML activity files');
    expect(serviceConnectionsSection?.content).toContain('reviewer workflows for device tests, YouTube videos, and blog posts');
    expect(serviceConnectionsSection?.content).toContain(`Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes`);
    expect(serviceConnectionsSection?.content).toContain('automatic provider sync and higher limits require a paid plan');
    expect(serviceConnectionsSection?.content).not.toContain('source-file workflows, AI insights, and reviewer workflows');
    expect(serviceConnectionsSection?.content).toContain('[Garmin Integration](/integrations/garmin)');
    expect(serviceConnectionsSection?.content).toContain('[COROS Integration](/integrations/coros)');
    expect(serviceConnectionsSection?.content).toContain('/integrations/suunto');
    expect(serviceConnectionsSection?.content).toContain('[Policies -> Connected Services](/policies#connected-services-data)');
    expect(serviceConnectionsSection?.content).toContain('[Policies -> Garmin Data](/policies#garmin-data)');
    expect(serviceConnectionsSection?.content).toContain('[Policies -> Suunto Data](/policies#suunto-data)');
    expect(serviceConnectionsSection?.content).toContain('[Policies -> COROS Data](/policies#coros-data)');
    expect(serviceConnectionsSection?.content).toContain('[AI & Third-Party Processing](/policies#ai-and-third-party-processing)');
    expect(serviceConnectionsSection?.content).toContain("Suunto FIT activity uploads in Services show each file's upload status");
    expect(serviceConnectionsSection?.content).toContain('retrying the same row checks that job instead of uploading the FIT again');
    expect(serviceConnectionsSection?.content).toContain('retry never replaces an issued job automatically');
    expect(serviceConnectionsSection?.content).toContain('clear the upload list and choose the FIT file again');
    expect(serviceConnectionsSection?.content).toContain('retry control');
    expect(serviceConnectionsSection?.content).toContain('processed one file at a time with short pauses');
    expect(serviceConnectionsSection?.content).toContain('Saved FIT and GPX routes can be sent to Suunto from **Routes**');
    expect(serviceConnectionsSection?.content).toContain('**Uploads** in Suunto Services also accepts a selected GPX or FIT route');
    expect(serviceConnectionsSection?.content).toContain('converts a selected FIT route to GPX in memory before delivery');
    expect(serviceConnectionsSection?.content).toContain('row action or the selected-row bulk toolbar');
    expect(serviceConnectionsSection?.content).toContain('uses the saved Quantified Self route name as the route name sent to Suunto');
    expect(serviceConnectionsSection?.content).toContain('Bulk sends upload routes one at a time');
    expect(serviceConnectionsSection?.content).toContain('Garmin to Suunto activity sync requires');
    expect(serviceConnectionsSection?.content).toContain('allow Activity Export in Garmin');
    expect(serviceConnectionsSection?.content).toContain('**Sync past activities** is available in Garmin Services');
    expect(serviceConnectionsSection?.content).toContain('uses the original files already saved with those activities');
    expect(serviceConnectionsSection?.content).toContain('sync past activities while automatic activity sync is off');
    expect(serviceConnectionsSection?.content).toContain('dashboard may offer a one-time action prompt to turn on automatic Garmin to Suunto activity sync');
    expect(serviceConnectionsSection?.content).toContain('Disconnecting Garmin, COROS, Suunto, or Wahoo turns off related automatic activity or route delivery');
    expect(serviceConnectionsSection?.content).toContain('Sleep sync is server-owned health data');
    expect(serviceConnectionsSection?.content).toContain('automatically importing daily sleep summaries from a rolling recent window');
    expect(serviceConnectionsSection?.content).toContain('importing available COROS sleep history from the last three months');
    expect(serviceConnectionsSection?.content).toContain('the COROS API does not expose sleep stages');
    expect(serviceConnectionsSection?.content).toContain('14d, 30d, 90d, and 1y range control');
    expect(serviceConnectionsSection?.content).toContain('independent from dashboard event filters');
    expect(serviceConnectionsSection?.content).toContain('overlays available vitals');
    expect(serviceConnectionsSection?.content).toContain('average sleep heart rate');
    expect(serviceConnectionsSection?.content).toContain('minimum sleep heart rate');
    expect(serviceConnectionsSection?.content).toContain('range-average reference lines');
    expect(serviceConnectionsSection?.content).toContain('max SpO2');
    expect(serviceConnectionsSection?.content).toContain('select **Sleep history** in Connections');
    expect(serviceConnectionsSection?.content).toContain('Import Sleep History');
    expect(serviceConnectionsSection?.content).toContain('COROS can import the available last three months');
    expect(serviceConnectionsSection?.content).toContain('Jan 1, 2016');
    expect(serviceConnectionsSection?.content).toContain('7-day cooldown');
    expect(serviceConnectionsSection?.content).toContain('30-day cooldown');
    expect(serviceConnectionsSection?.content).toContain('one-time dashboard prompt');
    expect(serviceConnectionsSection?.content).toContain('only the latest rolling **5 years** of activity data');
    expect(serviceConnectionsSection?.content).toContain('does not support an arbitrary older five-year period');
    expect(serviceConnectionsSection?.content).toContain('Garmin sleep history import is separate from activity history import');
    expect(serviceConnectionsSection?.content).toContain('COROS to Suunto activity sync requires');
    expect(serviceConnectionsSection?.content).toContain('COROS FIT activity uploads in Services are asynchronous and use per-file status');
    expect(serviceConnectionsSection?.content).toContain('short provider upload pacing');
    expect(serviceConnectionsSection?.content).toContain('checks that same upload first instead of posting the FIT again');
    expect(serviceConnectionsSection?.content).toContain('### Activity types COROS accepts');
    expect(serviceConnectionsSection?.content).toContain('Run, Indoor Run, Trail Run, Track Run, and Hike');
    expect(serviceConnectionsSection?.content).toContain('Pool Swim and Open Water Swim');
    expect(serviceConnectionsSection?.content).toContain('Stand Up Paddling may appear as **Other**');
    expect(serviceConnectionsSection?.content).toContain("Sailing and Snorkeling are not in COROS's documented import list");
    expect(serviceConnectionsSection?.content).toContain('COROS currently reports these processing failures only as a generic failed status');
    expect(serviceConnectionsSection?.content).toContain('https://support.coros.com/hc/en-us/articles/360040256971-How-to-Import-Activities-to-Your-COROS-Account');
    expect(serviceConnectionsSection?.content).toContain('uploading selected GPX or FIT routes to COROS');
    expect(serviceConnectionsSection?.content).toContain('sending saved routes to COROS individually or in selected-row bulk batches');
    expect(serviceConnectionsSection?.content).toContain('Garmin, Suunto, and Wahoo Services each offer COROS as an activity destination');
    expect(serviceConnectionsSection?.content).toContain('Automatic delivery is off by default');
    expect(serviceConnectionsSection?.content).toContain('one active connected account');
    expect(serviceConnectionsSection?.content).toContain('cycling-family routes use bike');
    expect(serviceConnectionsSection?.content).toContain('exact-file and semantic FIT fingerprints');
    expect(serviceConnectionsSection?.content).toContain('expire after about 120 days');
    expect(serviceConnectionsSection?.content).toContain('turn on automatic activity sync in COROS Services');
    expect(serviceConnectionsSection?.content).toContain('Automatic sync runs only for newly imported COROS activities');
    expect(serviceConnectionsSection?.content).toContain('**Sync past activities** is available in COROS Services');
    expect(serviceConnectionsSection?.content).toContain('sync past activities while automatic activity sync is off');
    expect(serviceConnectionsSection?.content).toContain('dashboard may offer a one-time action prompt to turn on automatic COROS to Suunto activity sync');
    expect(serviceConnectionsSection?.content).toContain('Wahoo to Suunto or COROS activity sync requires');
    expect(serviceConnectionsSection?.content).toContain('turn on automatic activity sync in Wahoo Services');
    expect(serviceConnectionsSection?.content).toContain('use Wahoo activities with a retained original FIT file');
    expect(serviceConnectionsSection?.content).toContain('Automatic sync runs only for newly imported eligible Wahoo activities');
    expect(serviceConnectionsSection?.content).toContain('**Sync past activities** in Wahoo Services');
    expect(serviceConnectionsSection?.content).toContain('Suunto users can turn on **Automatically send new and updated routes** in Suunto Services for Garmin or Wahoo; approved COROS route-pilot accounts also see COROS');
    expect(serviceConnectionsSection?.content).toContain('currently shown only to approved route-pilot accounts');
    expect(serviceConnectionsSection?.content).toContain('Every destination is opt-in and off by default');
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Integrations',
      icon: 'hub',
      kind: 'route',
      target: '/integrations',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Features',
      icon: 'dashboard_customize',
      kind: 'route',
      target: '/features',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Training Guides',
      icon: 'menu_book',
      kind: 'route',
      target: '/guides',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Workout Data Comparison',
      icon: 'compare_arrows',
      kind: 'route',
      target: '/features/workout-data-comparison',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Compare Files Tool',
      icon: 'compare_arrows',
      kind: 'route',
      target: '/tools/compare',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Workout File Analyzer',
      icon: 'analytics',
      kind: 'route',
      target: '/features/fit-gpx-tcx-file-analyzer',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'FIT and GPX Route Files',
      icon: 'route',
      kind: 'route',
      target: '/features/fit-gpx-route-files',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Import Activities to Suunto',
      icon: 'upload_file',
      kind: 'route',
      target: '/guides/import-activities-to-suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Import Activities to Wahoo',
      icon: 'upload_file',
      kind: 'route',
      target: '/guides/import-activities-to-wahoo',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Garmin to Suunto Guide',
      icon: 'sync_alt',
      kind: 'route',
      target: '/guides/sync-garmin-to-suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'COROS to Suunto Guide',
      icon: 'published_with_changes',
      kind: 'route',
      target: '/guides/sync-coros-to-suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Wahoo to Suunto Guide',
      icon: 'directions_bike',
      kind: 'route',
      target: '/guides/sync-wahoo-to-suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Centralize Workout Data',
      icon: 'hub',
      kind: 'route',
      target: '/guides/centralize-garmin-suunto-coros-workout-data',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Garmin Integration',
      icon: 'sync_alt',
      kind: 'route',
      target: '/integrations/garmin',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Suunto Integration',
      icon: 'published_with_changes',
      kind: 'route',
      target: '/integrations/suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'COROS Integration',
      icon: 'sync',
      kind: 'route',
      target: '/integrations/coros',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Connected Service Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_CONNECTED_SERVICES_FRAGMENT,
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Garmin Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_GARMIN_DATA_FRAGMENT,
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Suunto Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_SUUNTO_DATA_FRAGMENT,
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'COROS Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_COROS_DATA_FRAGMENT,
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'AI & Processors',
      icon: 'shield',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_AI_AND_PROCESSORS_FRAGMENT,
    });
  });

  it('documents Wahoo FIT imports, activity and route delivery, skip rules, and retained imported activities', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');
    expect(serviceConnectionsSection?.content).toContain('## Wahoo');
    expect(serviceConnectionsSection?.content).toContain('Workouts without a FIT file are skipped');
    expect(serviceConnectionsSection?.content).toContain('does **not** delete activities already imported');
    expect(serviceConnectionsSection?.content).toContain('send a FIT activity file directly to Wahoo');
    expect(serviceConnectionsSection?.content).toContain('checks that same upload instead of sending the FIT again');
    expect(serviceConnectionsSection?.content).toContain('send a GPX or FIT course or route file directly to Wahoo');
    expect(serviceConnectionsSection?.content).toContain('select **Reconnect Wahoo** in the displayed dialog');
    expect(serviceConnectionsSection?.content).toContain('Direct course/route delivery accepts GPX and FIT files');
    expect(serviceConnectionsSection?.content).toContain('not the ELEMNT App');
    expect(serviceConnectionsSection?.content).toContain('Garmin, COROS, or Suunto activities');
    expect(serviceConnectionsSection?.content).toContain('automatically send new Wahoo activities to Suunto');
    expect(serviceConnectionsSection?.content).toContain('Wahoo-origin FIT activities can be delivered to Suunto or COROS after explicit opt-in');
    expect(serviceConnectionsSection?.links).toContainEqual(expect.objectContaining({
      target: '/guides/sync-wahoo-to-suunto',
    }));
    expect(serviceConnectionsSection?.content).toContain('[Wahoo Integration](/integrations/wahoo)');
    expect(serviceConnectionsSection?.links).toContainEqual(expect.objectContaining({
      target: '/policies',
      fragment: POLICIES_WAHOO_DATA_FRAGMENT,
    }));
  });

  it('should expose provider-specific privacy links from the data-and-privacy section', () => {
    const dataAndPrivacySection = HELP_SECTIONS.find(section => section.id === 'data-and-privacy');

    expect(dataAndPrivacySection?.content).toContain('[Garmin Data](/policies#garmin-data)');
    expect(dataAndPrivacySection?.content).toContain('[Suunto Data](/policies#suunto-data)');
    expect(dataAndPrivacySection?.content).toContain('[COROS Data](/policies#coros-data)');
    expect(dataAndPrivacySection?.content).toContain('[Policies -> MCP Client Access](/policies#mcp-clients)');
    expect(dataAndPrivacySection?.content).toContain('[AI & Third-Party Processing](/policies#ai-and-third-party-processing)');
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'Garmin Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_GARMIN_DATA_FRAGMENT,
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'Suunto Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_SUUNTO_DATA_FRAGMENT,
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'COROS Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_COROS_DATA_FRAGMENT,
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'MCP Client Access',
      icon: 'devices',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_MCP_CLIENTS_FRAGMENT,
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'AI & Processors',
      icon: 'shield',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_AI_AND_PROCESSORS_FRAGMENT,
    });
  });

  it('documents MCP scopes, redaction, and revocation', () => {
    const dataAndPrivacySection = HELP_SECTIONS.find(section => section.id === 'data-and-privacy');

    expect(dataAndPrivacySection?.content).toContain('**Activity and Training metrics**');
    expect(dataAndPrivacySection?.content).toContain('**Body measurements**');
    expect(dataAndPrivacySection?.content).toContain('**Individual activity details**');
    expect(dataAndPrivacySection?.content).toContain('**Activity locations**');
    expect(dataAndPrivacySection?.content).toContain('**Sleep summaries**');
    expect(dataAndPrivacySection?.content).toContain('**Saved-route summaries**');
    expect(dataAndPrivacySection?.content).toContain('**Saved-route locations and geometry**');
    expect(dataAndPrivacySection?.content).toContain(
      'Precise latitude/longitude and first-class body-measurement metrics are excluded',
    );
    expect(dataAndPrivacySection?.content).toContain('up to 25 explicitly selected canonical numeric Sports Lib metrics');
    expect(dataAndPrivacySection?.content).toContain('first-class body-measurement history');
    expect(dataAndPrivacySection?.content).toContain('Removing a parent permission');
    expect(dataAndPrivacySection?.content).toContain('bounded ranges up to 366 days');
    expect(dataAndPrivacySection?.content).toContain('identity-free day, week, or month values');
    expect(dataAndPrivacySection?.content).toContain('not a medical or health assessment');
    expect(dataAndPrivacySection?.content).toContain('exact source measurement timestamps');
    expect(dataAndPrivacySection?.content).toContain('provider/device metadata');
    expect(dataAndPrivacySection?.content).toContain('bounded chart-ready heart-rate');
    expect(dataAndPrivacySection?.content).toContain('canonical Sports Lib activity types');
    expect(dataAndPrivacySection?.content).toContain('filter newest-first activity scans');
    expect(dataAndPrivacySection?.content).toContain('explicit IANA timezone');
    expect(dataAndPrivacySection?.content).toContain('complete no-match result');
    expect(dataAndPrivacySection?.content).toContain('your latest run');
    expect(dataAndPrivacySection?.content).toContain('today’s or yesterday’s workouts');
    expect(dataAndPrivacySection?.content).toContain('case-insensitive part of the route name');
    expect(dataAndPrivacySection?.content).toContain('older history');
    expect(dataAndPrivacySection?.content).toContain('without a reparse, backfill, cache');
    expect(dataAndPrivacySection?.content).toContain('imported device/provider source keys are removed');
    expect(dataAndPrivacySection?.content).toContain('exact activity start/end coordinates');
    expect(dataAndPrivacySection?.content).toContain('nearby activity searches');
    expect(dataAndPrivacySection?.content).toContain('MTB jump coordinates');
    expect(dataAndPrivacySection?.content).toContain('home, workplace, frequent trailhead');
    expect(dataAndPrivacySection?.content).toContain('Saved-route summary access');
    expect(dataAndPrivacySection?.content).toContain('Saved-route location access');
    expect(dataAndPrivacySection?.content).toContain('simplified preview geometry');
    expect(dataAndPrivacySection?.content).toContain('segment endpoints');
    expect(dataAndPrivacySection?.content).toContain('waypoint coordinates');
    expect(dataAndPrivacySection?.content).toContain('location text to Mapbox for forward geocoding');
    expect(dataAndPrivacySection?.content).toContain('does not send activity, route, account, or prompt data');
    expect(dataAndPrivacySection?.content).toContain('Original files');
    expect(dataAndPrivacySection?.content).toContain('full-resolution recordings');
    expect(dataAndPrivacySection?.content).toContain('raw sleep-stage intervals');
    expect(dataAndPrivacySection?.content).toContain('[**Connections -> MCP**](/services?serviceName=mcp)');
    expect(dataAndPrivacySection?.content).toContain('Only clients that finish authorization appear');
    expect(dataAndPrivacySection?.content).toContain('keeps its current grant usable');
    expect(dataAndPrivacySection?.content).toContain('instead of creating another logical connection');
    expect(dataAndPrivacySection?.content).toContain('Failed or abandoned authorization attempts');
    expect(dataAndPrivacySection?.content).toContain('do not replace an existing grant');
    expect(dataAndPrivacySection?.content).toContain('standard server-to-server token revocation');
    expect(dataAndPrivacySection?.content).toContain('Disconnect** in Connections remains the authoritative control');
    expect(dataAndPrivacySection?.content).toContain('any older duplicate records');
    expect(dataAndPrivacySection?.content).toContain('without affecting your other MCP clients');
  });

  it('directs account deletion to the Account settings section', () => {
    const dataAndPrivacySection = HELP_SECTIONS.find(section => section.id === 'data-and-privacy');

    expect(dataAndPrivacySection?.content).toContain('**Settings -> Account -> Danger Zone**');
    expect(dataAndPrivacySection?.content).not.toContain('**Settings -> Profile -> Danger Zone**');
  });

  it('should explain public event and comparison sharing exposure', () => {
    const dataAndPrivacySection = HELP_SECTIONS.find(section => section.id === 'data-and-privacy');

    expect(dataAndPrivacySection?.content).toContain('Event and saved comparison sharing is manual');
    expect(dataAndPrivacySection?.content).toContain('every object stored under that event\'s source-file folder');
    expect(dataAndPrivacySection?.content).toContain('users/{uid}/events/{eventId}/...');
    expect(dataAndPrivacySection?.content).toContain('Use **Stop sharing**');
    expect(dataAndPrivacySection?.content).toContain('cannot generate or save new reports');
  });
});
