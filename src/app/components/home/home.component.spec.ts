import { ComponentFixture, DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { SpyLocation } from '@angular/common/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { MatTooltip } from '@angular/material/tooltip';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BehaviorSubject } from 'rxjs';
import { ASSISTANT_REQUEST_LIMITS, USAGE_LIMITS, ROUTE_USAGE_LIMITS } from '@shared/limits';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { ShellNavigationEffectsService } from '../../services/shell-navigation-effects.service';
import { PublicFeaturePreviewComponent } from '../public-seo/public-feature-preview.component';
import { HomeComponent } from './home.component';

@Component({ standalone: true, template: '<p>Destination</p>' })
class HomeDestinationStub {}

describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;
  let userSubject: BehaviorSubject<{ uid: string } | null>;
  let router: Router;
  let location: SpyLocation;
  const selection = vi.fn();

  beforeEach(async () => {
    userSubject = new BehaviorSubject<{ uid: string } | null>(null);
    selection.mockClear();
    await TestBed.configureTestingModule({
      deferBlockBehavior: DeferBlockBehavior.Manual,
      imports: [HomeComponent, RouterTestingModule.withRoutes([]), MatIconTestingModule, NoopAnimationsModule],
      providers: [
        { provide: AppAuthService, useValue: { user$: userSubject.asObservable() } },
        { provide: AppHapticsService, useValue: { selection } },
        { provide: EChartsLoaderService, useValue: {
          load: vi.fn().mockResolvedValue(undefined),
          init: vi.fn().mockResolvedValue({ isDisposed: () => false, dispatchAction: vi.fn(), on: vi.fn(), off: vi.fn(), getWidth: () => 320 }),
          setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
          subscribeToViewportResize: () => () => undefined, attachMobileSeriesTapFeedback: () => () => undefined,
        } },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    location = TestBed.inject(Location) as SpyLocation;
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  function renderHome(): void {
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  }

  it('keeps anonymous visitors on home and redirects authenticated users to Dashboard', () => {
    renderHome();
    expect(router.navigate).not.toHaveBeenCalled();
    userSubject.next({ uid: 'test-user' });
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    vi.mocked(router.navigate).mockClear();
    fixture.destroy();
    userSubject.next({ uid: 'another-user' });
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('pairs the branded hero with a deferred chart preview and retains the detailed Training overview', async () => {
    renderHome();
    const hero = fixture.nativeElement.querySelector('.hero-section') as HTMLElement;
    expect(hero.querySelector('h1')?.textContent).toBe('All your training data. Across your devices. Under your control.');
    expect(hero.querySelector('.brand-name')?.textContent).toBe('Quantified Self.io');
    expect(hero.querySelector('app-public-feature-preview')).toBeTruthy();
    expect(hero.textContent).toContain('Sample data');
    expect(hero.querySelector('#hero-preview-title')?.textContent).toBe('Training load and recovery');
    expect(hero.querySelector('.preview-placeholder--hero')).toBeTruthy();
    const training = fixture.nativeElement.querySelector('#home-training') as HTMLElement;
    expect(training.textContent).toContain('Sample data');
    expect(training.querySelector('.preview-placeholder--training')).toBeTruthy();
    expect(training.querySelector('app-training-summary-cards')).toBeNull();
    const [, trainingBlock] = await fixture.getDeferBlocks();
    expect(trainingBlock).toBeTruthy();
    await trainingBlock.render(DeferBlockState.Complete);
    fixture.detectChanges();
    expect(training.querySelector('app-training-summary-cards')).toBeTruthy();
    expect(training.querySelectorAll('app-training-metric-grid')).toHaveLength(2);
    expect(hero.querySelector('a[href="/login"]')?.textContent).toContain('Get Started');
    expect(hero.querySelector('a[mat-flat-button]')?.getAttribute('href')).toBe('/login');
    expect(hero.querySelector('a[href="/pricing"]')).toBeNull();
    expect(hero.querySelector('a[mat-stroked-button]')?.getAttribute('href')).toBe('/features/training-analysis');
    expect(fixture.nativeElement.textContent).not.toMatch(/explore the demo|try the demo/i);
    expect(selection).not.toHaveBeenCalled();
  });

  it('links only to existing public discovery, membership and onboarding destinations', () => {
    renderHome();
    const paths = Array.from(fixture.nativeElement.querySelectorAll('a[href]'))
      .map((link: Element) => link.getAttribute('href')!);
    expect(paths.every(path => path === '/login' || path === '/integrations' || path === '/pricing'
      || path === '/help' || path === '/help#data-and-privacy'
      || path === '/guides/sync-wahoo-to-suunto' || path === '/guides/wahoo-garmin-training-data'
      || fixture.componentInstance.features.some(feature => path === '#home-' + feature.id)
      || path.startsWith('/features/'))).toBe(true);
    expect(paths).not.toContain('/demo');
    expect(fixture.nativeElement.querySelector('nav[aria-label="Homepage features"]')).toBeTruthy();
  });

  it('prepares homepage examples ahead of scrolling instead of presenting gray blocks', () => {
    renderHome();
    const previews = Array.from(fixture.nativeElement.querySelectorAll('app-public-feature-preview')) as HTMLElement[];
    expect(previews.length).toBeGreaterThan(0);
    expect(previews.every(preview => preview.classList.contains('preview-prepares-ahead'))).toBe(true);
  });

  it('exposes every supported provider logo and its name to assistive technology', () => {
    renderHome();
    const providerIntro = fixture.nativeElement.querySelector('.hero-section .provider-compatibility') as HTMLElement;
    expect(providerIntro.querySelector('h2')?.textContent).toBe('Bring It In. Keep It Moving.');
    expect(providerIntro.querySelector('.provider-compatibility__copy')?.textContent)
      .toBe('Pro brings new activities into one history automatically and lets you send them along supported sync paths. Connect Garmin, Suunto, COROS, or Wahoo; you choose which services exchange activities.');
    const logos = Array.from(fixture.nativeElement.querySelectorAll('.hero-visual .logos-container [role="img"]')) as HTMLElement[];
    expect(logos.map(logo => logo.getAttribute('aria-label'))).toEqual(['Garmin', 'Suunto', 'COROS', 'Wahoo']);
    expect(logos.every(logo => logo.getAttribute('aria-hidden') === 'false')).toBe(true);
    expect(providerIntro.querySelector('.logos-container')).toBeNull();
    const visual = fixture.nativeElement.querySelector('.hero-visual') as HTMLElement;
    expect(visual.querySelector('.hero-provider-wires')?.getAttribute('aria-hidden')).toBe('true');
    expect(visual.querySelector('app-public-feature-preview')).toBeTruthy();
    const borderTraces = Array.from(visual.querySelectorAll('.hero-product .hero-border-glow'));
    expect(borderTraces).toHaveLength(2);
    expect(borderTraces.every(trace => trace.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(visual.querySelector('.hero-connection-port')).toBeNull();
    for (const svg of visual.querySelectorAll('.hero-provider-wires')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.querySelectorAll('.hero-connection')).toHaveLength(4);
      expect(svg.querySelectorAll('.hero-connection .hero-connection-pulse')).toHaveLength(4);
      expect(svg.querySelectorAll('.hero-aggregate')).toHaveLength(1);
      expect(svg.querySelector('.hero-aggregate .hero-connection-pulse')).toBeNull();
      const trunk = svg.querySelector('.hero-aggregate .hero-connection-track')!;
      const endpoint = trunk.getAttribute('d')?.match(/^M (\d+ \d+)/)?.[1];
      expect(endpoint).toBeTruthy();
      expect(Array.from(svg.querySelectorAll('.hero-connection-track')).slice(0, 4)
        .every(path => path.getAttribute('d')?.endsWith(endpoint))).toBe(true);
      for (const connection of svg.querySelectorAll('.hero-connection')) {
        const branch = connection.querySelector('.hero-connection-track')!.getAttribute('d');
        const pulse = connection.querySelector('.hero-connection-pulse')!;
        expect(pulse.getAttribute('d')?.startsWith(`${branch} `)).toBe(true);
        expect(pulse.getAttribute('d')).toMatch(svg.classList.contains('hero-provider-wires--mobile') ? /V 104$/ : /H 136$/);
        expect(pulse.getAttribute('pathLength')).toBe('100');
      }
    }
    expect(visual.getAttribute('aria-label')).toContain('flow into Quantified Self');
  });

  it('lets visitors pause and resume decorative motion with one haptic per action', () => {
    renderHome();
    const visual = fixture.nativeElement.querySelector('.hero-visual') as HTMLElement;
    const toggle = visual.querySelector('.hero-motion-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-label')).toBe('Pause connection animation');
    expect(selection).not.toHaveBeenCalled();
    toggle.click();
    fixture.detectChanges();
    expect(visual.classList.contains('hero-motion-paused')).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Play connection animation');
    expect(selection).toHaveBeenCalledTimes(1);
    toggle.click();
    fixture.detectChanges();
    expect(visual.classList.contains('hero-motion-paused')).toBe(false);
    expect(toggle.getAttribute('aria-label')).toBe('Pause connection animation');
    expect(selection).toHaveBeenCalledTimes(2);
  });

  it('suspends offscreen and hidden-page motion without overriding the visitor pause choice', async () => {
    const observers: { callback: IntersectionObserverCallback; targets: Element[]; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      readonly targets: Element[] = [];
      readonly disconnect = vi.fn();
      readonly unobserve = vi.fn();
      constructor(readonly callback: IntersectionObserverCallback) { observers.push(this); }
      observe(target: Element): void { this.targets.push(target); }
    });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    try {
      renderHome();
      await fixture.whenStable();
      const visual = fixture.nativeElement.querySelector('.hero-visual') as HTMLElement;
      const observer = observers.find(item => item.targets.includes(visual))!;
      expect(observer).toBeTruthy();
      const intersect = (isIntersecting: boolean) => {
        observer.callback([{ target: visual, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
        fixture.detectChanges();
      };
      expect(fixture.componentInstance.heroMotionSuspended()).toBe(true);
      intersect(true);
      expect(visual.classList.contains('hero-motion-suspended')).toBe(false);
      const toggle = visual.querySelector('.hero-motion-toggle') as HTMLButtonElement;
      toggle.click();
      intersect(false);
      expect(visual.classList.contains('hero-motion-suspended')).toBe(true);
      intersect(true);
      expect(visual.classList.contains('hero-motion-suspended')).toBe(false);
      expect(visual.classList.contains('hero-motion-paused')).toBe(true);
      expect(toggle.getAttribute('aria-label')).toBe('Play connection animation');
      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
      expect(visual.classList.contains('hero-motion-suspended')).toBe(true);
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
      expect(visual.classList.contains('hero-motion-suspended')).toBe(false);
      expect(visual.classList.contains('hero-motion-paused')).toBe(true);
      expect(selection).toHaveBeenCalledTimes(1);
      fixture.destroy();
      expect(observer.disconnect).toHaveBeenCalledOnce();
      expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    } finally {
      fixture?.destroy();
      visibility.mockRestore();
      removeListener.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('leads with signup, keeps Starter access explicit and leaves pricing in membership', () => {
    renderHome();
    const hero = fixture.nativeElement.querySelector('.hero-section') as HTMLElement;
    expect(hero.querySelector('.hero-subtitle')?.textContent).toBe('Bring your Garmin, Suunto, COROS and Wahoo activities together. Understand your training, explore insights with AI, and keep your original files under your control.');
    expect(hero.querySelector('.hero-access-note')?.textContent).toContain('manual uploads and training analysis on free Starter');
    expect(hero.querySelector('.hero-access-note')?.textContent).toContain('Provider connections and automatic sync require Pro');
    const integrations = fixture.nativeElement.querySelector('#home-integrations') as HTMLElement;
    expect(hero.textContent).toContain('you choose which services exchange activities');
    expect(integrations.querySelector('.integration-actions a[href="/login"]')?.textContent).toContain('Get Started');
    expect(integrations.querySelector('a[href="/pricing"]')).toBeNull();
    expect(integrations.querySelector('.integration-actions a[href="/integrations"]')).toBeTruthy();
    expect(fixture.componentInstance.memberships.find(plan => plan.name === 'Pro')?.action).toBe('See pricing');
  });

  it.each([
    { selector: '.hero-actions a[href="/login"]', destination: '/login' },
    { selector: '.integration-actions a[href="/login"]', destination: '/login' },
    { selector: '.integration-actions a[href="/integrations"]', destination: '/integrations' },
    { selector: '.membership-grid mat-card:last-child a', destination: '/pricing' },
    { selector: '.hero-actions a[href="/features/training-analysis"]', destination: '/features/training-analysis' },
  ])('opens $destination from $selector with one shell-owned haptic', async ({ selector, destination }) => {
    renderHome();
    router.resetConfig(['', 'pricing', 'integrations', 'login', 'features/training-analysis'].map(path => ({ path, component: HomeDestinationStub })));
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    TestBed.inject(ShellNavigationEffectsService);
    await router.navigateByUrl('/');
    expect(selection).not.toHaveBeenCalled();

    fixture.nativeElement.querySelector(selector).click();
    await fixture.whenStable();

    expect(router.url).toBe(destination);
    expect(selection).toHaveBeenCalledTimes(1);
  });

  it.each([
    { selector: '.hero-actions a[href="/login"]', destination: 'login' },
    { selector: '.integration-actions a[href="/login"]', destination: 'login' },
    { selector: '.membership-grid mat-card:last-child a', destination: 'pricing' },
  ])('keeps canceled navigation from $selector silent', async ({ selector, destination }) => {
    renderHome();
    router.resetConfig([
      { path: '', component: HomeDestinationStub },
      { path: destination, component: HomeDestinationStub, canActivate: [() => false] },
    ]);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    TestBed.inject(ShellNavigationEffectsService);
    await router.navigateByUrl('/');

    fixture.nativeElement.querySelector(selector).click();
    await fixture.whenStable();

    expect(router.url).toBe('/');
    expect(selection).not.toHaveBeenCalled();
  });

  it('retains every shared product visual and detailed feature section', () => {
    renderHome();
    const sections = Array.from(fixture.nativeElement.querySelectorAll('.landing-page > section'))
      .map((section: Element) => section.className);
    expect(sections).toEqual(['hero-section', 'home-benefits', 'feature-section training-section',
      'feature-section workouts-section', 'feature-section training-plans-section', 'feature-section health-section',
      'feature-section ai-insights-section', 'feature-section footprint-section', 'feature-section analysis-section',
      'integrations-section', 'getting-started-section', 'membership-section', 'sovereignty-section', 'faq-section', 'final-cta-section']);
    const previews = fixture.debugElement.queryAll(By.directive(PublicFeaturePreviewComponent));
    expect(previews.map(preview => preview.componentInstance.previewKey()))
      .toEqual(['training-hero', 'training-snapshot', 'training-readiness', 'training-signals',
        'training-explorer', 'dashboard', 'workout-analysis', 'daily-workout', 'training-plans',
        'health-overview', 'health-sleep', 'health-hrv', 'health-note-comparison', 'health-weight', 'assistant-example', 'mcp-flow',
        'activity-map', 'reviewer-benchmark', 'provider-flow']);
    expect(previews.every(preview => !!preview.nativeElement.querySelector(':scope > div[data-nosnippet]'))).toBe(true);
    expect(fixture.nativeElement.querySelector('app-training-explorer-preview')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-workout-profile')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/features/workout-data-comparison"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('a[href="/features/activity-map"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('a[href="/features/mcp-server"]')).toBeTruthy();
    const copy = fixture.nativeElement.textContent as string;
    expect(copy).toContain('Charts Behind Every Signal');
    expect(copy).toContain('Curated, KPI, Custom, and Map tiles');
    expect(copy).toContain('aerobic durability, and cadence versus power');
    expect(copy).toContain('blood pressure, weight, body composition');
    const health = fixture.nativeElement.querySelector('#home-health') as HTMLElement;
    expect(health.textContent).toContain('What Changed Around Your Note?');
    expect(health.textContent).toContain('matching 7, 14, or 28-day windows');
    expect(health.textContent).toContain('Observed differences, not cause and effect');
    expect(health.querySelector('.preview-placeholder--note-comparison')).toBeTruthy();
    expect(health.querySelector('app-health-note-comparison-preview')).toBeNull();
    expect(copy).toContain('reference and test devices');
    const comparisonCopy = fixture.nativeElement.querySelector('#home-comparisons .section-heading') as HTMLElement;
    expect(comparisonCopy.textContent).toContain('R–R intervals and heart rate variability (HRV)');
    expect(comparisonCopy.closest('[data-nosnippet]')).toBeNull();
    expect(copy).toContain('location access remains separate');
    expect(fixture.nativeElement.querySelectorAll('.training-plans-section app-compact-row')).toHaveLength(7);
    expect(copy).toContain('A workout that fits today');
    expect(copy).toContain('One included daily workout suggestion');
    expect(fixture.nativeElement.querySelector('#home-plans-example-title')?.textContent)
      .toContain("Create Today's Workout");
  });

  it('uses shared tier limits and clearly distinguishes free uploads from Pro connections', () => {
    renderHome();
    const memberships = fixture.componentInstance.memberships;
    expect(memberships[0].features).toContain(`Up to ${USAGE_LIMITS.free} activities`);
    expect(memberships[0].features).toContain(`Up to ${ROUTE_USAGE_LIMITS.free} saved routes`);
    expect(memberships[0].features).toContain(`Up to ${ASSISTANT_REQUEST_LIMITS.free} Assistant requests per calendar month`);
    expect(memberships[1].features).toContain('Up to 1,000 activities');
    expect(memberships[1].features).toContain(`Up to ${ROUTE_USAGE_LIMITS.basic} saved routes`);
    expect(memberships[1].features).toContain(`Up to ${ASSISTANT_REQUEST_LIMITS.basic} Assistant requests per billing period`);
    expect(memberships[2].features).toContain(`Up to ${ASSISTANT_REQUEST_LIMITS.pro} Assistant requests per billing period`);
    expect(fixture.nativeElement.querySelectorAll('.membership-grid mat-card')).toHaveLength(3);
    expect(Array.from(fixture.nativeElement.querySelectorAll('.membership-grid h3'))
      .map((heading: Element) => heading.textContent)).toEqual(['Starter', 'Basic', 'Pro']);
    const steps = fixture.nativeElement.querySelector('.getting-started-steps');
    expect(steps.querySelectorAll('li')).toHaveLength(3);
    expect(steps.textContent).toContain('connect a supported provider with Pro');
    expect(fixture.nativeElement.querySelector('.membership-note').textContent).toContain('Paid prices');
  });

  it('opens and closes FAQ answers with one feedback owner and valid control targets', () => {
    renderHome();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.faq-row button')) as HTMLButtonElement[];
    expect(buttons.every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(buttons.every(button => !!fixture.nativeElement.querySelector('#' + button.getAttribute('aria-controls')))).toBe(true);
    buttons[0].click();
    fixture.detectChanges();
    expect(buttons[0].getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('#home-faq-watch').hidden).toBe(false);
    expect(selection).toHaveBeenCalledOnce();
    buttons[1].click();
    fixture.detectChanges();
    expect(buttons[0].getAttribute('aria-expanded')).toBe('false');
    expect(buttons[1].getAttribute('aria-expanded')).toBe('true');
    buttons[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.expandedFaq()).toBeNull();
    expect(selection).toHaveBeenCalledTimes(3);
    fixture.componentInstance.toggleFaq('invalid');
    expect(selection).toHaveBeenCalledTimes(3);
  });

  it('keeps every feature visible with direct jump links rather than selection controls', () => {
    renderHome();
    const links = Array.from(fixture.nativeElement.querySelectorAll('.home-navigation a')) as HTMLAnchorElement[];
    expect(links.map(link => link.getAttribute('href')))
      .toEqual(fixture.componentInstance.features.map(feature => '#home-' + feature.id));
    for (const feature of fixture.componentInstance.features) {
      const section = fixture.nativeElement.querySelector('#home-' + feature.id) as HTMLElement;
      expect(section.hidden).toBe(false);
      expect(section.hasAttribute('hidden')).toBe(false);
    }
    expect(fixture.nativeElement.querySelector('mat-tab-nav-panel')).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-select')).toBeNull();
    expect(selection).not.toHaveBeenCalled();
  });

  it.each(['training', 'workouts', 'plans', 'health', 'assistant', 'maps', 'comparisons', 'integrations'])(
    'jumps directly to %s without hiding or replacing any shared preview', async id => {
      renderHome();
      const previews = Array.from(fixture.nativeElement.querySelectorAll('app-public-feature-preview'));
      const target = fixture.nativeElement.querySelector('#home-' + id) as HTMLElement;
      const scrollIntoView = vi.fn();
      target.scrollIntoView = scrollIntoView;
      const heading = fixture.nativeElement.querySelector('#' + target.getAttribute('aria-labelledby')) as HTMLElement;
      expect(target.contains(heading)).toBe(true);
      const focus = vi.spyOn(heading, 'focus');
      fixture.nativeElement.querySelector(`.home-navigation a[href="#home-${id}"]`).click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
      expect(heading.tabIndex).toBe(-1);
      expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
      expect(location.path(true)).toBe('/#home-' + id);
      expect(selection).toHaveBeenCalledOnce();
      expect(Array.from(fixture.nativeElement.querySelectorAll('app-public-feature-preview'))).toEqual(previews);
      expect(fixture.nativeElement.querySelectorAll('section[hidden]')).toHaveLength(0);
    },
  );

  it('restores direct section links, query parameters and browser history silently', () => {
    renderHome();
    fixture.destroy();
    location.go('/?source=homepage#home-plans');
    fixture = TestBed.createComponent(HomeComponent);
    const plansScroll = vi.fn();
    const comparisonScroll = vi.fn();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('#home-plans').scrollIntoView = plansScroll;
    fixture.nativeElement.querySelector('#home-comparisons').scrollIntoView = comparisonScroll;
    fixture.componentInstance.jumpToFeature('comparisons');
    fixture.detectChanges();
    expect(comparisonScroll).toHaveBeenCalled();
    expect(location.path(true)).toBe('/?source=homepage#home-comparisons');
    expect(selection).toHaveBeenCalledOnce();
    location.simulateUrlPop('/?source=homepage#home-plans');
    fixture.detectChanges();
    expect(plansScroll).toHaveBeenCalled();
    location.simulateUrlPop('/?source=homepage#home-comparisons');
    fixture.detectChanges();
    expect(comparisonScroll).toHaveBeenCalledTimes(2);
    expect(selection).toHaveBeenCalledOnce();
  });

  it('moves focus into the chosen feature so keyboard navigation continues from that section', async () => {
    renderHome();
    document.body.appendChild(fixture.nativeElement);
    const link = fixture.nativeElement.querySelector('.home-navigation a[href="#home-health"]') as HTMLAnchorElement;
    const heading = fixture.nativeElement.querySelector('#home-health-title') as HTMLElement;
    const scrollIntoView = vi.fn();
    fixture.nativeElement.querySelector('#home-health').scrollIntoView = scrollIntoView;
    link.focus();
    link.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(heading);
    expect(heading.tabIndex).toBe(-1);
    expect(scrollIntoView).toHaveBeenCalled();
    link.focus();
    link.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(heading);
    expect(selection).toHaveBeenCalledOnce();
    fixture.nativeElement.remove();
  });

  it('keeps focus unchanged during browser history restoration', () => {
    renderHome();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    location.simulateUrlPop('/#home-health');
    fixture.detectChanges();
    expect(focus).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();
  });

  it('returns Back to the exact unanchored view and Forward to the point left within a feature', () => {
    renderHome();
    const shell = document.createElement('mat-sidenav-content');
    document.body.appendChild(shell);
    shell.appendChild(fixture.nativeElement);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const go = vi.spyOn(location, 'go');
    shell.scrollTop = 380;
    shell.scrollLeft = 12;
    fixture.nativeElement.querySelector('#home-health').scrollIntoView = vi.fn();

    fixture.componentInstance.jumpToFeature('health');
    fixture.detectChanges();
    shell.scrollTop = 4200;
    shell.scrollLeft = 0;
    location.back();
    fixture.detectChanges();
    expect(shell.scrollTop).toBe(380);
    expect(shell.scrollLeft).toBe(12);
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'instant' });
    expect(location.path(true)).toBe('');

    location.forward();
    fixture.detectChanges();
    expect(shell.scrollTop).toBe(4200);
    expect(shell.scrollLeft).toBe(0);
    expect(location.path(true)).toBe('/#home-health');
    expect(go).toHaveBeenCalledOnce();
    expect(selection).toHaveBeenCalledOnce();
    fixture.destroy();
    shell.remove();
  });

  it('keeps separate reading positions for repeated visits to the same feature URL', () => {
    renderHome();
    const shell = document.createElement('mat-sidenav-content');
    document.body.appendChild(shell);
    shell.appendChild(fixture.nativeElement);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    fixture.nativeElement.querySelector('#home-training').scrollIntoView = vi.fn();
    fixture.nativeElement.querySelector('#home-maps').scrollIntoView = vi.fn();
    fixture.componentInstance.jumpToFeature('training');
    fixture.detectChanges();
    shell.scrollTop = 1100;
    fixture.componentInstance.jumpToFeature('maps');
    fixture.detectChanges();
    shell.scrollTop = 7300;
    fixture.componentInstance.jumpToFeature('training');
    fixture.detectChanges();
    shell.scrollTop = 1900;

    location.back();
    fixture.detectChanges();
    expect(shell.scrollTop).toBe(7300);
    location.back();
    fixture.detectChanges();
    expect(shell.scrollTop).toBe(1100);
    location.forward();
    fixture.detectChanges();
    location.forward();
    fixture.detectChanges();
    expect(shell.scrollTop).toBe(1900);
    expect(selection).toHaveBeenCalledTimes(3);
    fixture.destroy();
    shell.remove();
  });

  it('preserves existing query/history state and restores a saved view after recreating the homepage', () => {
    renderHome();
    const shell = document.createElement('mat-sidenav-content');
    document.body.appendChild(shell);
    shell.appendChild(fixture.nativeElement);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    location.replaceState('/?source=homepage', '', { navigationId: 12, otherState: 'preserved' });
    shell.scrollTop = 480;
    fixture.nativeElement.querySelector('#home-plans').scrollIntoView = vi.fn();
    fixture.componentInstance.jumpToFeature('plans');
    fixture.detectChanges();
    expect(location.path(true)).toBe('/?source=homepage#home-plans');
    location.back();
    fixture.detectChanges();
    expect(location.getState()).toMatchObject({ navigationId: 12, otherState: 'preserved' });
    expect(location.path(true)).toBe('/?source=homepage');
    fixture.destroy();
    shell.scrollTop = 0;
    fixture = TestBed.createComponent(HomeComponent);
    shell.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    expect(shell.scrollTop).toBe(480);
    expect(selection).toHaveBeenCalledOnce();
    fixture.destroy();
    shell.remove();
  });

  it('keeps initialization, invalid and unchanged destinations silent and cleans up history listeners', () => {
    renderHome();
    const component = fixture.componentInstance;
    component.jumpToFeature('invalid');
    expect(location.path(true)).toBe('');
    expect(selection).not.toHaveBeenCalled();
    component.jumpToFeature('training');
    fixture.detectChanges();
    expect(selection).toHaveBeenCalledOnce();
    component.jumpToFeature('training');
    fixture.detectChanges();
    expect(selection).toHaveBeenCalledOnce();
    location.simulateUrlPop('/#unknown');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('section[hidden]')).toHaveLength(0);
    fixture.destroy();
    location.simulateUrlPop('/#home-health');
    expect(selection).toHaveBeenCalledOnce();
  });

  it('preserves modified section links and leaves public-route haptics to the shell', () => {
    renderHome();
    const event = new MouseEvent('click', { ctrlKey: true, cancelable: true });
    fixture.componentInstance.jumpToFeature('health', event);
    expect(event.defaultPrevented).toBe(false);
    expect(location.path(true)).toBe('');
    expect(selection).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('a[href="/features/training-analysis"]').hasAttribute('appHapticTap')).toBe(false);
    expect(fixture.debugElement.queryAll(By.directive(MatTooltip))
      .every(host => host.injector.get(MatTooltip).touchGestures === 'off')).toBe(true);
  });
});
