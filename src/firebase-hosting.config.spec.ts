import { readFileSync } from 'node:fs';
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
    destination: string;
  }>;
}

interface FirebaseConfig {
  hosting: FirebaseHostingTarget[];
}

interface AngularBuildOptions {
  assets: Array<string | { glob: string; input: string; output: string }>;
}

interface AngularConfig {
  projects: {
    'track-tools': {
      architect: {
        build: {
          options: AngularBuildOptions;
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
const siteOrigin = 'https://quantified-self.io';
const betaNoIndexHeader = {
  key: 'X-Robots-Tag',
  value: 'noindex, nofollow',
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

describe('Firebase Hosting configuration', () => {
  it('rewrites only known CSR app routes so unknown URLs can fall through to 404.html', () => {
    for (const target of firebaseConfig.hosting) {
      const rewrites = target.rewrites ?? [];
      const sources = rewrites.map(rewrite => rewrite.source);

      expect(target.public).toBe('dist/browser');
      expect(sources).toEqual(expectedCsrRewriteSources);
      expect(new Set(sources).size).toBe(sources.length);
      expect(sources).not.toContain('**');
      expect(sources).not.toContain('/**');
      expect(sources.every(source => !source.includes('**'))).toBe(true);

      for (const rewrite of rewrites) {
        expect(rewrite.destination).toBe('/index.csr.html');
      }
    }
  });

  it('matches known CSR URLs without masking prerendered or unknown URLs', () => {
    const sources = firebaseConfig.hosting[0]?.rewrites?.map(rewrite => rewrite.source) ?? [];

    expect(matchesAnyHostingSource(sources, '/dashboard')).toBe(true);
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
    expect(matchesAnyHostingSource(sources, '/features/ai-insights')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/tools')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/tools/compare')).toBe(false);
    expect(matchesAnyHostingSource(sources, '/help')).toBe(false);
  });

  it('keeps all prerendered public routes out of Firebase and service-worker CSR fallbacks', () => {
    const hostingSources = firebaseConfig.hosting[0]?.rewrites?.map(rewrite => rewrite.source) ?? [];
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
      `${siteOrigin}/integrations`,
      `${siteOrigin}/integrations/garmin`,
      `${siteOrigin}/integrations/suunto`,
      `${siteOrigin}/features/fit-gpx-route-files`,
      `${siteOrigin}/guides`,
      `${siteOrigin}/guides/sync-suunto-routes-to-garmin-courses`,
    ];

    for (const url of updatedUrls) {
      expect(sitemapLastmodForUrl(url), url).toBe(expectedLastmod);
    }
  });

  it('marks Training launch surfaces and Help content as recently updated in sitemap', () => {
    expect(sitemapLastmodForUrl(`${siteOrigin}/`)).toBe('2026-07-18');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features`)).toBe('2026-07-18');
    expect(sitemapLastmodForUrl(`${siteOrigin}/features/training-analysis`)).toBe('2026-07-18');
    expect(sitemapLastmodForUrl(`${siteOrigin}/help`)).toBe('2026-07-19');
  });

  it('keeps private client-rendered routes out of sitemap and disallowed by robots', () => {
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/tools/compare/saved</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/share/event/');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/share/comparison/');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/routes</loc>');
    expect(sitemapXml).not.toContain('<loc>https://quantified-self.io/training</loc>');
    expect(robotsTxt).toContain('Disallow: /tools/compare/saved');
    expect(robotsTxt).toContain('Disallow: /routes');
    expect(robotsTxt).toContain('Disallow: /training');
  });

  it('marks public share routes noindex at the hosting layer', () => {
    const productionTarget = firebaseConfig.hosting.find(target => target.target === 'production');
    const eventShareHeaders = productionTarget?.headers?.find(header => header.source === '/share/event/**')?.headers ?? [];
    const comparisonShareHeaders = productionTarget?.headers?.find(header => header.source === '/share/comparison/**')?.headers ?? [];

    expect(eventShareHeaders).toContainEqual(betaNoIndexHeader);
    expect(comparisonShareHeaders).toContainEqual(betaNoIndexHeader);
  });

  it('copies the static Firebase 404 page into the hosting output', () => {
    const assets = angularConfig.projects['track-tools'].architect.build.options.assets;

    expect(assets).toContain('src/404.html');
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

    expect(positiveNavigationUrls).toEqual(expectedCsrRewriteSources);
    expect(navigationUrls).not.toContain('/**');
    expect(positiveNavigationUrls.every(url => !url.includes('**'))).toBe(true);
    expect(navigationUrls).toContain('!/**/*.*');
  });
});
