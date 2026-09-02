import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_RENDERED_APP_ROUTES,
  PRERENDERED_PUBLIC_ROUTES,
} from './app/app.routes.server';

interface FirebaseHostingTarget {
  target: string;
  public: string;
  headers?: Array<{
    source: string;
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
}

interface FirebaseConfig {
  hosting: FirebaseHostingTarget[];
}

interface AngularBuildOptions {
  assets: Array<string | { glob: string; input: string; output: string }>;
  styles: string[];
}

interface AngularBuildConfiguration {
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

interface ServiceWorkerConfig {
  navigationUrls: string[];
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
const expectedMcpFunctionRewriteSources = [
  '/mcp',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/oauth/authorize',
  '/oauth/token',
  '/oauth/revoke',
];
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
    source === allowSource || (allowSource !== '/' && source.startsWith(`${allowSource}/`))
  ));
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
  it('rewrites only known CSR app routes so unknown URLs can fall through to 404.html', () => {
    for (const target of firebaseConfig.hosting) {
      const rewrites = target.rewrites ?? [];
      const csrRewrites = rewrites.filter(rewrite => rewrite.destination !== undefined);
      const functionRewrites = rewrites.filter(rewrite => rewrite.function !== undefined);
      const sources = csrRewrites.map(rewrite => rewrite.source);

      expect(target.public).toBe('dist/browser');
      expect(sources).toEqual(expectedCsrRewriteSources);
      expect(functionRewrites.map(rewrite => rewrite.source)).toEqual(expectedMcpFunctionRewriteSources);
      expect(new Set(rewrites.map(rewrite => rewrite.source)).size).toBe(rewrites.length);
      expect(sources).not.toContain('**');
      expect(sources).not.toContain('/**');
      expect(sources.every(source => !source.includes('**'))).toBe(true);

      for (const rewrite of csrRewrites) {
        expect(rewrite.destination).toBe('/index.csr.html');
      }
      for (const rewrite of functionRewrites) {
        expect(rewrite.function).toEqual({
          functionId: 'mcpApi',
          region: 'europe-west2',
        });
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
    expect(matchesAnyHostingSource(sources, '/routes')).toBe(true);
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

  it('marks route-delivery SEO launch pages as recently updated in sitemap', () => {
    const expectedLastmod = '2026-06-26';
    const updatedUrls = [
      `${siteOrigin}/features/fit-gpx-route-files`,
      `${siteOrigin}/guides/sync-suunto-routes-to-garmin-courses`,
    ];

    for (const url of updatedUrls) {
      expect(sitemapLastmodForUrl(url), url).toBe(expectedLastmod);
    }
  });

  it('marks recently updated public discovery surfaces in sitemap', () => {
    expect(sitemapLastmodForUrl(`${siteOrigin}/`)).toBe('2026-08-03');
    expect(sitemapLastmodForUrl(`${siteOrigin}/pricing`)).toBe('2026-08-03');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features`)).toBe('2026-08-03');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/activity-calendar`)).toBe('2026-08-04');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/ai-insights`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/mcp-server`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/integrations`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/integrations/garmin`)).toBe('2026-08-03');
    expect(sitemapLastmodForUrl(`${siteOrigin}/integrations/suunto`)).toBe('2026-08-03');
    expect(sitemapLastmodForUrl(`${siteOrigin}/integrations/coros`)).toBe('2026-08-26');
    expect(sitemapLastmodForUrl(`${siteOrigin}/integrations/wahoo`)).toBe('2026-08-03');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/workout-data-comparison`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/supported-activities`)).toBe('2026-08-24');
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides`)).toBe('2026-07-21');
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides/import-activities-to-suunto`)).toBe('2026-07-28');
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides/import-activities-to-wahoo`)).toBe('2026-07-28');
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides/sync-wahoo-to-suunto`)).toBe('2026-07-21');
    expect(sitemapLastmodForUrl(`${siteOrigin}/guides/centralize-garmin-suunto-coros-workout-data`)).toBe('2026-07-21');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/training-analysis`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/training-dashboard`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/activity-map`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/workout-file-comparison`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/fit-gpx-tcx-file-analyzer`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/sports-watch-benchmark`)).toBe('2026-09-02');
    expect(sitemapLastmodForUrl(`${siteOrigin}/help`)).toBe('2026-08-26');
    expect(sitemapLastmodForUrl(`${siteOrigin}/policies`)).toBe('2026-08-26');
    expect(sitemapLastmodForUrl(`${siteOrigin}/privacy`)).toBe('2026-08-26');
    expect(sitemapLastmodForUrl(`${siteOrigin}/terms`)).toBe('2026-08-05');
  });

  it('keeps private client-rendered routes out of sitemap and disallowed by robots', () => {
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/tools/compare/saved</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/share/event/');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/share/comparison/');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/routes</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/calendar</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/training</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/health</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/mcp</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/mcp/authorize</loc>');
    expect(robotsTxt).toContain('Disallow: /tools/compare/saved');
    expect(robotsTxt).toContain('Disallow: /routes');
    expect(robotsTxt).toContain('Disallow: /calendar');
    expect(robotsTxt).toContain('Disallow: /training');
    expect(robotsTxt).toContain('Disallow: /health');
    expect(robotsTxt).toContain('Disallow: /mcp');
    expect(robotsTxt).toContain('Disallow: /mcp/authorize');
    expect(robotsTxt).toContain('Disallow: /oauth/');
    expect(robotsTxt).toContain('Disallow: /.well-known/oauth-protected-resource');
    expect(robotsTxt).toContain('Disallow: /.well-known/oauth-authorization-server');
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

    expect(targetHeaderSets[1]).toEqual(targetHeaderSets[0]);
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
