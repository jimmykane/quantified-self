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
    expect(startup.enableProdMode).toHaveBeenCalledOnce();
    expect(startup.registerLocale).toHaveBeenCalledOnce();
    expect(startup.loadAppModule).toHaveBeenCalledOnce();
    expect(startup.bootstrapModule).toHaveBeenCalledExactlyOnceWith(startup.AppModule);
    expect(document.body.classList.contains('dark-theme')).toBe(true);
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
});
