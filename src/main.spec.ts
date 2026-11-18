import { createHash, webcrypto } from 'node:crypto';
import { BrowserClient, defaultStackParser, logger, withScope, type Envelope } from '@sentry/browser';
import { logBrowserPushRemoval } from './app/helpers/push-removal-log.helper';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startup = vi.hoisted(() => ({
  redirect: vi.fn(),
  initSentry: vi.fn(),
  browserTracing: vi.fn(),
  enableProdMode: vi.fn(),
  registerLocale: vi.fn(),
  loadAppModule: vi.fn(),
  bootstrapModule: vi.fn(),
  platformBrowserDynamic: vi.fn(),
  environment: {
    localhost: false,
    production: true,
    beta: false,
    appUrl: 'https://quantified-self.io',
    appVersion: 'test'
  },
  AppModule: class AppModule {}
}));

vi.mock('@angular/core', () => ({ enableProdMode: startup.enableProdMode }));
vi.mock('@angular/platform-browser-dynamic', () => ({ platformBrowserDynamic: startup.platformBrowserDynamic }));
vi.mock('@sports-alliance/sports-lib', () => ({ AppThemes: { Normal: 'Normal', Dark: 'Dark' } }));
vi.mock('@sentry/angular', () => ({ init: startup.initSentry, browserTracingIntegration: startup.browserTracing }));
vi.mock('./environments/environment', () => ({ environment: startup.environment }));
vi.mock('./app/shared/adapters/date-locale.config', () => ({ registerAppLocale: startup.registerLocale }));
vi.mock('./app/shared/adapters/firebase-hosting-redirect', () => ({ redirectFromFirebaseHostingAlias: startup.redirect }));

describe('browser startup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    startup.environment.localhost = false;
    startup.environment.production = true;
    startup.redirect.mockReturnValue(false);
    startup.registerLocale.mockResolvedValue(undefined);
    startup.bootstrapModule.mockResolvedValue(undefined);
    startup.platformBrowserDynamic.mockReturnValue({ bootstrapModule: startup.bootstrapModule });
    vi.doMock('./app/app.module', () => {
      startup.loadAppModule();
      return { AppModule: startup.AppModule };
    });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    localStorage.clear();
    document.body.classList.remove('dark-theme');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not initialize telemetry or load the App Check-owning app module after requesting a redirect', async () => {
    startup.redirect.mockReturnValue(true);

    await import('./main');
    await vi.dynamicImportSettled();

    expect(startup.redirect).toHaveBeenCalledExactlyOnceWith(false, 'https://quantified-self.io');
    expect(startup.initSentry).not.toHaveBeenCalled();
    expect(startup.browserTracing).not.toHaveBeenCalled();
    expect(startup.enableProdMode).not.toHaveBeenCalled();
    expect(startup.registerLocale).not.toHaveBeenCalled();
    expect(startup.loadAppModule).not.toHaveBeenCalled();
    expect(startup.platformBrowserDynamic).not.toHaveBeenCalled();
    expect(startup.bootstrapModule).not.toHaveBeenCalled();
    expect(window.matchMedia).not.toHaveBeenCalled();
  });

  it('keeps normal production startup when no redirect is requested', async () => {
    localStorage.setItem('appTheme', 'Dark');

    await import('./main');
    await vi.dynamicImportSettled();

    expect(startup.initSentry).toHaveBeenCalledOnce();
    expect(startup.initSentry).toHaveBeenCalledWith(expect.objectContaining({
      release: 'test',
      initialScope: { tags: { build_commit: 'unknown', build_run: 'unknown', build_dirty: 'unknown' } },
    }));
    expect(startup.enableProdMode).toHaveBeenCalledOnce();
    expect(startup.registerLocale).toHaveBeenCalledOnce();
    expect(startup.loadAppModule).toHaveBeenCalledOnce();
    expect(startup.bootstrapModule).toHaveBeenCalledExactlyOnceWith(startup.AppModule);
    expect(document.body.classList.contains('dark-theme')).toBe(true);
  });

  it('emits a timestamped Sentry log with searchable references and no raw identity or credentials', async () => {
    await import('./main'); await vi.dynamicImportSettled();
    const { enableLogs, beforeSendLog } = startup.initSentry.mock.calls[0][0];
    const envelopes: Envelope[] = [];
    const client = new BrowserClient({ dsn: 'https://public@example.invalid/1', integrations: [], stackParser: defaultStackParser,
      enableLogs, beforeSendLog, sendClientReports: false,
      transport: () => ({ send: async envelope => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }) });
    vi.stubGlobal('crypto', webcrypto);
    client.init();
    try {
      await withScope(async scope => {
        scope.setClient(client);
        scope.setUser({ id: 'private-uid', email: 'private-email@example.invalid' });
        logger.info('unrelated-log-canary');
        await logBrowserPushRemoval({ uid: 'private-uid', installationId: 'private-installation',
          reason: 'signed_out', action: 'browser_detached', origin: 'https://quantified-self.io',
          device: { browser: 'Chrome', platform: 'macOS' } });
      });
      await client.flush(1000);
      const items = envelopes.flatMap(envelope => envelope[1]);
      expect(items).toHaveLength(1);
      expect(items[0][0].type).toBe('log');
      const payload = items[0][1] as { items: unknown[] };
      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]).toMatchObject({ body: 'Web push device removal', level: 'info', timestamp: expect.any(Number),
        attributes: { reason: { value: 'signed_out' }, action: { value: 'browser_detached' }, browser: { value: 'Chrome' },
          platform: { value: 'macOS' }, accountRef: { value: createHash('sha256').update('qs-web-push:account:private-uid').digest('hex') },
          deviceRef: { value: createHash('sha256').update('qs-web-push:device:private-installation').digest('hex') } } });
      expect(JSON.stringify(envelopes)).not.toMatch(/private-|unrelated-log-canary/);
    } finally { await client.close(1000); }
  });

  it('keeps localhost startup without production telemetry', async () => {
    startup.environment.localhost = true;
    startup.environment.production = false;

    await import('./main');
    await vi.dynamicImportSettled();

    expect(startup.redirect).toHaveBeenCalledExactlyOnceWith(true, 'https://quantified-self.io');
    expect(startup.initSentry).not.toHaveBeenCalled();
    expect(startup.enableProdMode).not.toHaveBeenCalled();
    expect(startup.registerLocale).toHaveBeenCalledOnce();
    expect(startup.bootstrapModule).toHaveBeenCalledExactlyOnceWith(startup.AppModule);
  });
  it('attaches the build constants to Sentry without changing release or adding a dist', async () => {
    vi.stubGlobal('QS_BUILD_COMMIT', 'a'.repeat(40)); vi.stubGlobal('QS_BUILD_RUN', '123.2'); vi.stubGlobal('QS_BUILD_DIRTY', false);
    await import('./main'); await vi.dynamicImportSettled();
    expect(startup.initSentry).toHaveBeenCalledWith(expect.objectContaining({ release: 'test', initialScope: {
      tags: { build_commit: 'a'.repeat(40), build_run: '123.2', build_dirty: 'false' },
    } }));
    expect(startup.initSentry.mock.calls[0][0]).not.toHaveProperty('dist');
  });
});
