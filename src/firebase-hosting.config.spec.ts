import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Generator, type Config as ServiceWorkerConfig } from '@angular/service-worker/config';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_RENDERED_APP_ROUTES,
  PRERENDERED_PUBLIC_ROUTES,
  PUBLIC_REDIRECT_ROUTES,
} from './app/app.routes.server';
import { LEGACY_WORKOUT_DATA_COMPARISON_PATHS } from './app/components/features/workout-data-comparison-page.paths';
import { PUBLIC_ENTRY_REDIRECTS } from './app/shared/public-entry-redirects';

interface FirebaseHostingTarget {
  target: string;
  public: string;
  headers?: Array<{
    source?: string;
    regex?: string;
    headers: Array<{
      key: string;
      value: string;
    }>;
  }>;
  rewrites?: Array<{
    source: string;
    destination?: string;
    function?: {
      functionId: string;
      region: string;
    };
  }>;
  redirects?: Array<{
    source: string;
    destination: string;
    type: number;
  }>;
}

interface FirebaseConfig {
  hosting: FirebaseHostingTarget[];
}

interface AngularBuildOptions {
  assets: Array<string | { glob: string; input: string; output: string }>;
  styles: string[];
}

interface AngularBuildConfiguration {
  outputHashing?: string;
  budgets?: Array<{ type: string; maximumWarning?: string; maximumError?: string }>;
  optimization?: boolean | {
    styles?: {
      inlineCritical?: boolean;
    };
  };
}

interface AngularConfig {
  projects: {
    'track-tools': {
      architect: {
        build: {
          options: AngularBuildOptions;
          configurations: Record<string, AngularBuildConfiguration>;
        };
      };
    };
  };
}

const firebaseConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../firebase.json'), 'utf8')
) as FirebaseConfig;

const angularConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../angular.json'), 'utf8')
) as AngularConfig;

const serviceWorkerConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../ngsw-config.json'), 'utf8')
) as ServiceWorkerConfig;

const static404Html = readFileSync(resolve(__dirname, '404.html'), 'utf8');
const robotsTxt = readFileSync(resolve(__dirname, 'robots.txt'), 'utf8');
const sitemapXml = readFileSync(resolve(__dirname, 'sitemap.xml'), 'utf8');

const expectedCsrRewriteSources = CLIENT_RENDERED_APP_ROUTES.map(routePathToHostingSource);
const expectedComparisonRedirects = LEGACY_WORKOUT_DATA_COMPARISON_PATHS.map(path => ({
  source: routePathToHostingSource(path),
  destination: '/features/workout-data-comparison',
  type: 301,
}));
const expectedMcpFunctionRewriteSources = [
  '/mcp',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/oauth/authorize',
  '/oauth/token',
  '/oauth/revoke',
];
const unsubscribeFunctionRewrite = {
  source: '/email/unsubscribe',
  function: { functionId: 'marketingUnsubscribe', region: 'europe-west2' },
};
const siteOrigin = 'https://quantified-self.io';
const betaNoIndexHeader = {
  key: 'X-Robots-Tag',
  value: 'noindex, nofollow',
};
const networkOnlyAuthSources = ['/mcp/authorize', '/login'];
const mcpAuthorizeEnforcedCsp = "base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'";
const mcpAuthorizeSecurityHeaders = {
  'Content-Security-Policy': mcpAuthorizeEnforcedCsp,
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function routePathToHostingSource(path: string): string {
  return `/${path.replace(/:[^/]+/g, '*')}`;
}

function matchesHostingSource(source: string, path: string): boolean {
  if (source === path) {
    return true;
  }

  const sourceSegments = source.split('/').filter(Boolean);
  const pathSegments = path.split('/').filter(Boolean);

  if (sourceSegments.length !== pathSegments.length) {
    return false;
  }

  return sourceSegments.every((segment, index) => segment === '*' || segment === pathSegments[index]);
}

function matchesAnyHostingSource(sources: readonly string[], path: string): boolean {
  return sources.some(source => matchesHostingSource(source, path));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sitemapLastmodForUrl(url: string): string | null {
  const match = sitemapXml.match(new RegExp(`<url>\\s*<loc>${escapeRegExp(url)}</loc>\\s*<lastmod>([^<]+)</lastmod>`, 'm'));

  return match?.[1] ?? null;
}

function isAllowedByRobots(source: string): boolean {
  const allowSources = robotsTxt
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('Allow: '))
    .map(line => line.replace('Allow: ', ''));

  return allowSources.some(allowSource => (
    allowSource === '/' || source === allowSource || source.startsWith(`${allowSource}/`)
  ));
}

function sitemapUrls(): string[] {
  return [...sitemapXml.matchAll(/<loc>(https:\/\/quantified-self\.io[^<]*)<\/loc>/g)]
    .map(([, url]) => url);
}

function headerSourceMatchesPath(source: string, path: string): boolean {
  if (source === '**' || source === '/**') {
    return true;
  }

  const sourceSegments = source.split('/').filter(Boolean);
  const pathSegments = path.split('/').filter(Boolean);
  let pathIndex = 0;

  for (let sourceIndex = 0; sourceIndex < sourceSegments.length; sourceIndex += 1) {
    const sourceSegment = sourceSegments[sourceIndex];
    if (sourceSegment === '**') {
      return true;
    }
    if (pathIndex >= pathSegments.length || (sourceSegment !== '*' && sourceSegment !== pathSegments[pathIndex])) {
      return false;
    }
    pathIndex += 1;
  }

  return pathIndex === pathSegments.length;
}

function findHtmlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      return findHtmlFiles(entryPath);
    }

    return entry.isFile() && entry.name.endsWith('.html') ? [entryPath] : [];
  });
}

function getCspDirective(policy: string, directiveName: string): string | undefined {
  return policy
    .split(';')
    .map(directive => directive.trim())
    .find(directive => directive === directiveName || directive.startsWith(`${directiveName} `));
}

describe('Firebase Hosting configuration', () => {
  it.each(['production', 'beta'])('caches only fingerprinted media immutably on %s', configuration => {
    const target = firebaseConfig.hosting.find(hosting => hosting.target === configuration);
    const immutableHeaders = target.headers.filter(entry => entry.headers.some(header =>
      header.key.toLowerCase() === 'cache-control' && header.value.includes('immutable')));

    expect(angularConfig.projects['track-tools'].architect.build.configurations[configuration].outputHashing).toBe('all');
    expect(immutableHeaders).toHaveLength(1);
    expect(immutableHeaders[0].source).toBeUndefined();
    expect(immutableHeaders[0].regex).toBeDefined();
    expect(immutableHeaders[0].headers).toEqual([
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
    ]);

    const pattern = new RegExp(immutableHeaders[0].regex);
    for (const path of [
      '/media/inter-latin-400-normal-55WT6UWF.woff2',
      '/media/material-symbols-rounded-latin-400-normal-FQYDMJ5A.woff2',
      '/media/inter-latin-400-normal-1234ABCD.woff',
      '/media/icon-1234ABCD.svg',
      '/media/icon-1234ABCD.png',
    ]) {
      expect(pattern.test(path), path).toBe(true);
    }
    for (const path of [
      '/media/inter.woff2', '/media/icon.svg', '/assets/favicons/favicon-32x32.png',
      '/index.html', '/index.csr.html', '/help/index.html', '/manifest.json',
      '/ngsw.json', '/ngsw-worker.js', '/media/index-1234ABCD.html',
      '/media/icon-1234ABCD.svg.html', '/media/nested/icon-1234ABCD.svg',
    ]) {
      expect(pattern.test(path), path).toBe(false);
    }
  });

  it('includes emitted media in the lazy asset cache with stable font hashes across releases', async () => {
    const fontPaths = [
      '/media/inter-latin-400-normal-55WT6UWF.woff2',
      '/media/material-symbols-rounded-latin-400-normal-FQYDMJ5A.woff2',
    ];
    const files: Record<string, string> = {
      '/index.csr.html': 'first release',
      [fontPaths[0]]: 'font bytes',
      [fontPaths[1]]: 'icon font bytes',
      '/media/icon-1234ABCD.svg': '<svg/>',
    };
    const generator = new Generator({
      async list() { return Object.keys(files); },
      async read(path) { return files[path]; },
      async hash(path) { return createHash('sha1').update(files[path]).digest('hex'); },
      async write() { throw new Error('Unexpected fixture write'); },
    }, '/');
    type Manifest = {
      hashTable: Record<string, string>;
      assetGroups: Array<{ name: string; installMode: string; updateMode: string; urls: string[] }>;
    };
    const first = await generator.process(serviceWorkerConfig) as Manifest;
    files['/index.csr.html'] = 'second release';
    const second = await generator.process(serviceWorkerConfig) as Manifest;

    expect(first.hashTable['/index.csr.html']).not.toBe(second.hashTable['/index.csr.html']);
    for (const manifest of [first, second]) {
      const assets = manifest.assetGroups.find(group => group.name === 'assets');
      expect(assets).toMatchObject({ installMode: 'lazy', updateMode: 'prefetch' });
      expect(assets.urls).toEqual(expect.arrayContaining([...fontPaths, '/media/icon-1234ABCD.svg']));
      for (const path of fontPaths) {
        expect(manifest.assetGroups.find(group => group.name === 'app').urls).not.toContain(path);
        expect(manifest.hashTable[path]).toBe(createHash('sha1').update(files[path]).digest('hex'));
      }
    }
  });

  it('serves pre-release Plans at its Training URL without retaining /plans as a redirect, rewrite, or offline fallback', () => {
    for (const hosting of firebaseConfig.hosting) {
      const rewriteSources = (hosting.rewrites ?? []).map(rewrite => rewrite.source);
      const redirectSources = (hosting.redirects ?? []).map(redirect => redirect.source);

      expect(matchesAnyHostingSource(rewriteSources, '/training/plans')).toBe(true);
      expect(matchesAnyHostingSource(rewriteSources, '/plans')).toBe(false);
      expect(matchesAnyHostingSource(redirectSources, '/plans')).toBe(false);
    }
    expect(serviceWorkerConfig.navigationUrls).toContain('/training/plans');
    expect(serviceWorkerConfig.navigationUrls).not.toContain('/plans');
  });

  it('permanently redirects legacy comparison pages to the consolidated canonical page', () => {
    for (const target of firebaseConfig.hosting) {
      expect(target.redirects).toEqual(expect.arrayContaining(expectedComparisonRedirects));
      expect(target.redirects?.every(redirect => redirect.type === 301)).toBe(true);

      const rewriteSources = new Set((target.rewrites ?? []).map(rewrite => rewrite.source));
      for (const redirect of expectedComparisonRedirects) {
        expect(rewriteSources.has(redirect.source)).toBe(false);
      }
    }
  });

  it('redirects public membership and help entry links without hiding unknown paths or indexing aliases', () => {
    const entryRedirects = PUBLIC_ENTRY_REDIRECTS.map(({ path, destination }) => ({
      source: `/${path}`, destination, type: 301,
    }));
    for (const target of firebaseConfig.hosting) {
      expect(target.redirects).toEqual([...entryRedirects, ...expectedComparisonRedirects]);
      const sources = (target.redirects ?? []).map(redirect => redirect.source);
      expect(matchesAnyHostingSource(sources, '/help/unknown-topic')).toBe(false);
      expect(matchesAnyHostingSource(sources, '/membership/unknown')).toBe(false);
      for (const { source } of entryRedirects) {
        expect(sitemapUrls()).not.toContain(`${siteOrigin}${source}`);
        expect(serviceWorkerConfig.navigationUrls).not.toContain(source);
      }
    }
    expect(PUBLIC_REDIRECT_ROUTES).toEqual([
      ...LEGACY_WORKOUT_DATA_COMPARISON_PATHS,
      ...PUBLIC_ENTRY_REDIRECTS.map(redirect => redirect.path),
    ]);
    // Includes contextual provider offers, trial review and paginated Connections navigation.
    // Includes shared history-progress lifecycle/refresh guidance and local Dashboard visibility controls (26 October).
    // Includes the Pro trial payment-method and cancellation terms refreshed today.
    // Includes public Stripe billing access for members who cannot sign in to QS (28 October).
    // Manual-history help now explains existing-account verification and reconnect requirements.
    // Pool-swim help covers interval chart focus, data coverage, recorded membership and keyboard header explanations.
    // Training swim help also covers Rest text priority, automatic same-Guide updates and explicit additional copies.
    // Training editor help covers explicit duration summaries, new-Rest defaults and non-blocking duration comparisons.
    // Dashboard help keeps the greeting assessment and Today details visible by default; selecting the sentence collapses or reopens the details (2026-10-29).
    // Calendar generation help covers default-on Training/Timeline context with independent opt-outs, Calendar/Dashboard entry points, searchable sport selection, expanded default-on Personalization choices for freshness/HRV/recovery, selected-sport weekday routines from complete prior local days, the shared Assistant allowance footer, eligible dates and safe retries (2026-10-29).
    // It applies swim units to weekly distances and the SWOLF pool-length label.
    // Table-filter help covers compact text buttons, the calendar dialog, selected dates and per-filter clearing (2026-10-29).
    // Calendar help covers standalone rest on any date, independent plan markers, immediate cache masking/removal and unchanged daily allowance (2026-10-31).
    // MCP, Help and Policies cover standalone rest reads and revision-bound preview/Apply under independent Training changes consent (2026-10-31).
    // Daily workout suggestion help covers opt-in Pro suggestions, current-sleep waiting/rechecks, explicit available-data fallback, all-day foreground preparation and saved-zone dates, separate daily allowance, the daily browser cache, status-only coverage before Review, sign-out cleanup, explicit Add and resuming after deleting today's planned workout without resetting the allowance (2026-10-30).
    // Activity table help covers initial placeholders, retained rows and paused row actions while refreshing (2026-10-30).
    // R–R help also separates filtered Suunto HR, raw statistics, recorded FIT HR and historical reparse (2026-10-30).
    // Planned-workout editor help includes its recoverable Delete workout footer action (2026-10-31).
    // Saved-workout help includes post-Add Send/sync review, Today delivery actions and the explicit plan-settings link (2026-10-31).
    // It also covers saved-schedule recovery and dismissing the saved confirmation during sync navigation (2026-10-31).
    // AI rest review includes explicit Calendar rest marking and unchanged generation allowance (2026-11-01).
    // History progress help distinguishes quiet automatic retries and later queued sections (2026-11-01).
    // Daily suggestions retain saved recipes after check failures and distinguish lost responses (2026-11-01).
    expect(sitemapLastmodForUrl(`${siteOrigin}/help`)).toBe('2026-11-01');
  });

  it('rewrites only known CSR app routes so unknown URLs can fall through to 404.html', () => {
    for (const target of firebaseConfig.hosting) {
      const rewrites = target.rewrites ?? [];
      const csrRewrites = rewrites.filter(rewrite => rewrite.destination !== undefined);
      const functionRewrites = rewrites.filter(rewrite => rewrite.function !== undefined);
      const sources = csrRewrites.map(rewrite => rewrite.source);

      expect(target.public).toBe('dist/browser');
      expect(sources).toEqual(expectedCsrRewriteSources);
      expect(functionRewrites.map(rewrite => rewrite.source)).toEqual([
        ...expectedMcpFunctionRewriteSources,
        unsubscribeFunctionRewrite.source,
      ]);
      expect(new Set(rewrites.map(rewrite => rewrite.source)).size).toBe(rewrites.length);
      expect(sources).not.toContain('**');
      expect(sources).not.toContain('/**');
      expect(sources.every(source => !source.includes('**'))).toBe(true);

      for (const rewrite of csrRewrites) {
        expect(rewrite.destination).toBe('/index.csr.html');
      }
      for (const rewrite of functionRewrites) {
        expect(rewrite.function).toEqual(rewrite.source === unsubscribeFunctionRewrite.source
          ? unsubscribeFunctionRewrite.function
          : { functionId: 'mcpApi', region: 'europe-west2' });
      }
    }
  });

  it('matches known CSR URLs without masking prerendered or unknown URLs', () => {
    const sources = firebaseConfig.hosting[0]?.rewrites
      ?.filter(rewrite => rewrite.destination !== undefined)
      .map(rewrite => rewrite.source) ?? [];

    expect(matchesAnyHostingSource(sources, '/mcp/authorize')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/dashboard')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/calendar')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/calendar/day/2026-09-25')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/training/plans/library')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/training/plans/library/new')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/training/plans/library/saved-workout-1')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/routes')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/tags')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/activities')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/activities/unknown')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/health/compare')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/health/compare/example-note')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/health/compare/example-note/extra')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/admin/queues/workout')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/admin/queues/route-reparse')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/user/user-1/event/event-1')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/share/event/user-1/event-1')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/share/comparison/user-1/event-1')).toBe(true);
    expect(matchesAnyHostingSource(sources, '/tools/compare/saved')).toBe(true);

    expect(matchesAnyHostingSource(sources, '/admin/missing')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/user/user-1/event/event-1/extra')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/share/event/user-1/event-1/extra')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/definitely-missing')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/integrations/garmin')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/features/activity-calendar')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/calendar/day/2026-09-25/extra')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/features/ai-insights')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/tools')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/tools/compare')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/help')).toBe(false);
  });

  it('keeps all prerendered public routes out of Firebase and service-worker CSR fallbacks', () => {
    const hostingSources = firebaseConfig.hosting[0]?.rewrites
      ?.filter(rewrite => rewrite.destination !== undefined)
      .map(rewrite => rewrite.source) ?? [];
    const positiveNavigationUrls = serviceWorkerConfig.navigationUrls.filter(url => !url.startsWith('!'));
    const prerenderedPublicSources = PRERENDERED_PUBLIC_ROUTES.map(routePathToHostingSource);

    for (const source of prerenderedPublicSources) {
      expect(hostingSources).not.toContain(source);
      expect(positiveNavigationUrls).not.toContain(source);
    }
  });

  it('lists every prerendered public route in sitemap and keeps it allowed by robots', () => {
    for (const path of PRERENDERED_PUBLIC_ROUTES) {
      const source = routePathToHostingSource(path);
      const url = `${siteOrigin}${source}`;

      expect(sitemapXml).toContain(`<loc>${url}</loc>`);
      expect(isAllowedByRobots(source)).toBe(true);
    }
  });

  it('keeps the sitemap exactly aligned with prerendered public routes', () => {
    const expectedUrls = PRERENDERED_PUBLIC_ROUTES
      .map(path => `${siteOrigin}${routePathToHostingSource(path)}`)
      .sort();

    expect(sitemapUrls().sort()).toEqual(expectedUrls);
  });

  it('records the route-delivery feature launch and the newer guide setup fix in sitemap', () => {
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/fit-gpx-route-files`)).toBe('2026-06-26');
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides/sync-suunto-routes-to-garmin-courses`)).toBe('2026-10-24');
  });

  it('marks note-comparison previews and other recently updated public discovery surfaces in sitemap', () => {
    // Help also describes bounded dashboard freshness retries, Health range menus, newest-first sorting and empty notices.
    // Help also documents the collapsed R-R chart panel, overlaid recordings and legend labels for unavailable beats.
    // Help also explains ongoing-note comparisons, stored versus requested history,
    // QS-calculated Garmin sleep-window HR, remembered Plans/Standalone navigation,
    // measurement-first Heart rate choices, compact history, source comparison, visible coverage and recording details,
    // bounded background Training rebuilds during bulk imports/reparse,
    // browser verification recovery with bounded temporary-error retries,
    // and display-only Raw/3s Power charts with recorded peaks and dips.
    // Includes saved Continuous/Detect/Custom event chart continuity and single-week Efficiency display.
    // This same-day Help revision includes ascent corrections/reset and file-supplied sports on safely matched updates.
    // Help covers power data, ascent corrections, history-import refresh timing, HRV chart eligibility and compact summary controls.
    // File-comparison signup help also covers required account setup and the return to Compare.
    // COROS history help also explains cross-client admission, partial scans and queued-work completion.
    // MCP signup help also covers returning to explicit consent, denial and request expiry after free setup.
    // Startup recovery help covers the 15-second deadline and reload without clearing browser storage.
    // Checkout help covers the 20-second access check, confirmed Pro setup and recovery before another payment.
    // Event chart help covers compact option submenus and scrolling to reach every menu setting.
    expect(sitemapLastmodForUrl(`${siteOrigin}/help`)).toBe('2026-11-01');
    // Homepage keeps the provider introduction near the hero and moves integration details after the product features.
    expect(sitemapLastmodForUrl(`${siteOrigin}/`)).toBe('2026-10-28');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/health`)).toBe('2026-10-15');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features`)).toBe('2026-10-09');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/activity-calendar`)).toBe('2026-10-09');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/ai-insights`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/mcp-server`)).toBe('2026-10-31');
    expect(sitemapLastmodForUrl(`${siteOrigin}/integrations`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/integrations/garmin`)).toBe('2026-10-24');
    expect(sitemapLastmodForUrl(`${siteOrigin}/integrations/suunto`)).toBe('2026-10-13');
    // COROS and Help describe Diving-to-Generic copies without requiring GPS.
    expect(sitemapLastmodForUrl(`${siteOrigin}/integrations/coros`)).toBe('2026-10-28');
    expect(sitemapLastmodForUrl(`${siteOrigin}/integrations/wahoo`)).toBe('2026-10-24');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/workout-data-comparison`)).toBe('2026-10-23');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/supported-activities`)).toBe('2026-10-17');
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides`)).toBe('2026-10-24');
    // Same-day guide review corrects scheduling counts versus Suunto delivery confirmation.
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides/sync-garmin-to-suunto`)).toBe('2026-10-24');
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides/sync-garmin-to-wahoo`)).toBe('2026-10-24');
    // COROS guide clarifies the history limit and keeps its setup tab through signup.
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides/sync-coros-to-suunto`)).toBe('2026-10-25');
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides/import-activities-to-suunto`)).toBe('2026-10-24');
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides/import-activities-to-wahoo`)).toBe('2026-10-24');
    // Wahoo-to-Suunto distinguishes delivery paths and preserves setup context through sign-in/onboarding.
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides/sync-wahoo-to-suunto`)).toBe('2026-10-25');
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides/centralize-garmin-suunto-coros-workout-data`)).toBe('2026-07-21');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/training-analysis`)).toBe('2026-10-09');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/training-plans`)).toBe('2026-10-09');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/training-dashboard`)).toBe('2026-10-09');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/activity-map`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/fit-gpx-tcx-file-analyzer`)).toBe('2026-09-02');
    expect(sitemapXml).not.toContain(`${siteOrigin}/features/workout-file-comparison`);
    expect(sitemapXml).not.toContain(`${siteOrigin}/features/sports-watch-benchmark`);
    // Help includes the dialog feedback and safe haptic behavior guidance.
    // This same-day Help revision covers sentence-only Dashboard glance, Health recovery, and the event-chart zone-color toggle.
    // Billing help covers maintenance, checkout switching and expiry recovery (2026-10-26).
    // Health help also covers primary Heart rate choices, nightly HRV history, same-account daily averages, automatic retries and final failures.
    // It also documents the flat Training & health navigation for Plans and Timeline notes.
    // Help now distinguishes the comparisons landing page from the explicit note manager.
    // The same date also covers bounded Suunto initialization retries and acceptance-uncertainty guidance.
    // Help uses Duplicate to… consistently for workout actions and completed-workout sync details.
    // Swimming Guide screen controls are scoped to individual pool/open-water swimming workouts.
    // Help distinguishes last/next planned Work distances from measured results and the Work/Rest counter.
    // Event details also distinguishes session Max HR from selected-lap peaks, including rest.
    // Event details now documents the compact TSS / Workout CTL / Day CTL strip.
    // The same-day Help revision clarifies preview timeouts, source provenance and checked/ready/excluded draft counts.
    // Account deletion now lives in the separate Data management settings section.
    // Help also explains the sport-wide threshold-HR estimate in Sports Lib 23.1.0.
    // Dashboard range help also covers rolling seven-day windows and the previous calendar month.
    // Recording-update help also covers stable legs, saved preferences and retained-original reprocessing.
    // Benchmark R–R help covers source-separated summaries, linked plots and the original-timing boundary.
    // R–R & HRV summaries and plots cover ordinary events and multisport legs; paired-stat deltas remain benchmark-only.
    // Saved comparisons also explains cached R–R statistics, the detail dialog and unloaded draft rows.
    // Help also documents Poincaré pairs, flagged-point inspection and preserved adjacency.
    // Poincaré help also covers the responsive square plot and browser-supported fullscreen controls.
    // Artifact help explains QS-specific flags and why values differ across platforms.
    // Single-lap tables omit the persistent Summary row; selected summaries remain available.
    // Single-activity Jumps tables omit redundant activity tabs, while multi-activity tables retain them.
    // Unambiguous Session end segments append as Final lap rows without changing recorded data.
    // Pool swims default to Duration and disable the Distance chart axis.
    // Strength-name previews disclose interval-only summaries and point to Edit for saved lifting loads.
    // Swimming Guide help explains inline omissions, visible layout-limit warnings and the HR-target field budget.
    // Form/TSS axes fit the displayed period without changing training values or hiding the neutral baseline.
    // Swimming Automatic prioritizes CSS before HR/MET and excludes calculated power TSS.
    expect(sitemapLastmodForUrl(`${siteOrigin}/help`)).toBe('2026-11-01');
    expect(sitemapLastmodForUrl(`${siteOrigin}/policies`)).toBe('2026-10-31');
    expect(sitemapLastmodForUrl(`${siteOrigin}/privacy`)).toBe('2026-10-31');
    expect(sitemapLastmodForUrl(`${siteOrigin}/terms`)).toBe('2026-10-07');
  });

  it('keeps client-rendered routes out of the sitemap and noindexed at the hosting layer', () => {
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/tools/compare/saved</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/share/event/');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/share/comparison/');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/routes</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/calendar</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/training/plans</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/training</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/health</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/tags</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/activities</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/mcp</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/mcp/authorize</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/login</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/pricing</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/releases</loc>');
    expect(robotsTxt).toContain('Disallow: /mcp');
    expect(robotsTxt).toContain('Allow: /mcp/authorize');
    expect(robotsTxt).toContain('Disallow: /oauth/');
    expect(robotsTxt).toContain('Disallow: /.well-known/oauth-protected-resource');
    expect(robotsTxt).toContain('Disallow: /.well-known/oauth-authorization-server');

    const productionTarget = firebaseConfig.hosting.find(target => target.target === 'production');
    const noIndexHeaders = productionTarget?.headers?.filter(header => (
      header.headers.some(headerValue => (
        headerValue.key === betaNoIndexHeader.key && headerValue.value === betaNoIndexHeader.value
      ))
    )) ?? [];

    for (const routePath of CLIENT_RENDERED_APP_ROUTES) {
      const routeSource = routePathToHostingSource(routePath);
      expect(
        noIndexHeaders.some(header => headerSourceMatchesPath(header.source, routeSource)),
        routePath,
      ).toBe(true);
    }
  });

  it('marks public share routes noindex at the hosting layer', () => {
    const productionTarget = firebaseConfig.hosting.find(target => target.target === 'production');
    const eventShareHeaders = productionTarget?.headers?.find(header => header.source === '/share/event/**')?.headers ?? [];
    const comparisonShareHeaders = productionTarget?.headers?.find(header => header.source === '/share/comparison/**')?.headers ?? [];

    expect(eventShareHeaders).toContainEqual(betaNoIndexHeader);
    expect(comparisonShareHeaders).toContainEqual(betaNoIndexHeader);
  });

  it('hardens network-only MCP authorization and login entry points', () => {
    const targetHeaderSets: Array<FirebaseHostingTarget['headers'][number]['headers']> = [];

    for (const source of networkOnlyAuthSources) {
      expect(serviceWorkerConfig.navigationUrls).not.toContain(source);
    }

    for (const target of firebaseConfig.hosting) {
      const protectedHeaderEntries = target.headers
        ?.filter(header => networkOnlyAuthSources.includes(header.source)) ?? [];

      expect(protectedHeaderEntries.map(entry => entry.source)).toEqual(networkOnlyAuthSources);
      expect(protectedHeaderEntries[1]?.headers).toEqual(protectedHeaderEntries[0]?.headers);

      const headers = protectedHeaderEntries[0]?.headers ?? [];
      const headersByKey = Object.fromEntries(headers.map(header => [header.key, header.value]));
      targetHeaderSets.push(headers);

      expect(new Set(headers.map(header => header.key)).size).toBe(headers.length);
      expect(headersByKey).toMatchObject(mcpAuthorizeSecurityHeaders);

      const reportOnlyPolicy = headersByKey['Content-Security-Policy-Report-Only'];
      expect(reportOnlyPolicy).toBeDefined();
      expect(getCspDirective(reportOnlyPolicy, 'default-src')).toBe("default-src 'self'");
      expect(getCspDirective(reportOnlyPolicy, 'base-uri')).toBe("base-uri 'self'");
      expect(getCspDirective(reportOnlyPolicy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
      expect(getCspDirective(reportOnlyPolicy, 'object-src')).toBe("object-src 'none'");
      expect(getCspDirective(reportOnlyPolicy, 'form-action')).toBe("form-action 'self'");
      expect(getCspDirective(reportOnlyPolicy, 'script-src-attr')).toBe("script-src-attr 'none'");
      expect(getCspDirective(reportOnlyPolicy, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
      expect(getCspDirective(reportOnlyPolicy, 'worker-src')).toBe("worker-src 'self' blob:");
      expect(reportOnlyPolicy).toContain('https://*.googleapis.com');
      expect(reportOnlyPolicy).toContain('https://*.firebaseio.com');
      expect(reportOnlyPolicy).toContain('https://*.cloudfunctions.net');
      expect(reportOnlyPolicy).toContain('https://*.ingest.sentry.io');
      expect(reportOnlyPolicy).toContain('https://*.g.doubleclick.net');
      expect(reportOnlyPolicy).toContain('https://api.mapbox.com');
      expect(reportOnlyPolicy).toContain('https://www.googletagmanager.com');
      expect(reportOnlyPolicy).toContain('https://www.google.com/recaptcha/');
      expect(reportOnlyPolicy).toContain('https://recaptcha.google.com/recaptcha/');
      expect(getCspDirective(reportOnlyPolicy, 'script-src')).toContain("'wasm-unsafe-eval'");
      expect(reportOnlyPolicy).not.toContain("'unsafe-eval'");
      expect(reportOnlyPolicy).not.toContain('default-src *');
      expect(reportOnlyPolicy).not.toContain('script-src https:');
      expect(reportOnlyPolicy).not.toContain('https://*.mapbox.com');
    }

    expect(targetHeaderSets[0]).toContainEqual(betaNoIndexHeader);
    expect(targetHeaderSets[1]).not.toContainEqual(betaNoIndexHeader);
  });

  it('keeps executable scripts and event handlers compatible with a strict script policy', () => {
    const indexHtml = readFileSync(resolve(__dirname, 'index.html'), 'utf8');
    const appHtmlFiles = findHtmlFiles(resolve(__dirname, 'app'));
    const filesWithInlineHandlers = appHtmlFiles.filter(filePath => (
      /\son[a-z]+\s*=/i.test(readFileSync(filePath, 'utf8'))
    ));

    expect(indexHtml).toContain('<script src="assets/theme-init.js"></script>');
    expect(indexHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(filesWithInlineHandlers).toEqual([]);

    for (const configurationName of ['production', 'beta']) {
      expect(
        angularConfig.projects['track-tools'].architect.build
          .configurations[configurationName]?.optimization
      ).toMatchObject({
        styles: {
          inlineCritical: false,
        },
      });
    }
  });

  it.each(['production', 'beta'])('bounds total scripts with matching release budgets for %s', configuration => {
    const budgets = angularConfig.projects['track-tools'].architect.build.configurations[configuration].budgets;
    expect(budgets?.find(budget => budget.type === 'allScript')).toEqual({
      // Measured daily check recovery adds 1.76 kB beyond the prior ceiling; retain the startup limit.
      type: 'allScript', maximumWarning: '13000kb', maximumError: '13825kb',
    });
  });

  it.each(['production', 'beta'])('bounds the sports-lib 23.5 startup output for %s', configuration => {
    const budgets = angularConfig.projects['track-tools'].architect.build.configurations[configuration].budgets;
    // Published 23.5.0 with power and R-R metrics measures 1,472.76 kB of initial output.
    // Keep a narrow matching startup limit for both release builds, independent of allScript.
    expect(budgets?.find(budget => budget.type === 'initial')).toEqual({
      type: 'initial', maximumWarning: '1474kb', maximumError: '1474kb',
    });
  });

  it('copies the static Firebase 404 page into the hosting output', () => {
    const assets = angularConfig.projects['track-tools'].architect.build.options.assets;

    expect(assets).toContain('src/404.html');
  });

  it('publishes the canonical favicon at the conventional root path', () => {
    const assets = angularConfig.projects['track-tools'].architect.build.options.assets;

    expect(assets).toContainEqual({
      glob: 'favicon.ico',
      input: 'src/assets/favicons',
      output: '/',
    });
    expect(assets).not.toContain('src/favicon.ico');
  });

  it('ships Mapbox CSS as a lazy static asset instead of a lazy stylesheet chunk', () => {
    const assets = angularConfig.projects['track-tools'].architect.build.options.assets;
    const styles = angularConfig.projects['track-tools'].architect.build.options.styles;

    expect(assets).toContainEqual({
      glob: 'mapbox-gl.css',
      input: 'node_modules/mapbox-gl/dist',
      output: 'assets/mapbox-gl',
    });
    expect(styles).not.toContain('node_modules/mapbox-gl/dist/mapbox-gl.css');
  });

  it('keeps the static Firebase 404 page noindexed and useful without JavaScript', () => {
    expect(static404Html).toContain('<meta name="robots" content="noindex, follow">');
    expect(static404Html).toContain('<h1>Page not found</h1>');
    expect(static404Html).toContain('<a href="/">Go Home</a>');
  });

  it('keeps custom 404 responses on a short cache lifetime', () => {
    for (const target of firebaseConfig.hosting) {
      expect(target.headers).toContainEqual({
        source: '404.html',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=300',
          },
        ],
      });
    }
  });

  it('keeps beta hosting out of search indexes without applying noindex to production', () => {
    const betaTarget = firebaseConfig.hosting.find(target => target.target === 'beta');
    const productionTarget = firebaseConfig.hosting.find(target => target.target === 'production');
    const betaGlobalHeaders = betaTarget?.headers?.find(header => header.source === '**')?.headers ?? [];
    const productionGlobalHeaders = productionTarget?.headers?.find(header => header.source === '**')?.headers ?? [];

    expect(betaGlobalHeaders).toContainEqual(betaNoIndexHeader);
    expect(productionGlobalHeaders).not.toContainEqual(betaNoIndexHeader);
  });

  it('keeps service-worker navigation fallback scoped to known CSR routes', () => {
    const navigationUrls = serviceWorkerConfig.navigationUrls;
    const positiveNavigationUrls = navigationUrls.filter(url => !url.startsWith('!'));
    const cacheableCsrRewriteSources = expectedCsrRewriteSources
      .filter(source => !networkOnlyAuthSources.includes(source));

    expect(positiveNavigationUrls).toEqual(cacheableCsrRewriteSources);
    expect(navigationUrls).not.toContain('/**');
    expect(positiveNavigationUrls.every(url => !url.includes('**'))).toBe(true);
    expect(navigationUrls).toContain('!/**/*.*');
  });
});
