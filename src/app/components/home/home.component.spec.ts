import { ComponentFixture, DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
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
import { PublicFeaturePreviewComponent } from '../public-seo/public-feature-preview.component';
import { HomeComponent } from './home.component';

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
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    location = TestBed.inject(Location) as SpyLocation;
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  });

  it('keeps anonymous visitors on home and redirects authenticated users to Dashboard', () => {
    expect(router.navigate).not.toHaveBeenCalled();
    userSubject.next({ uid: 'test-user' });
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    vi.mocked(router.navigate).mockClear();
    fixture.destroy();
    userSubject.next({ uid: 'another-user' });
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('restores the branded hero and keeps the shared Training overview in its feature section', async () => {
    const hero = fixture.nativeElement.querySelector('.hero-section') as HTMLElement;
    expect(hero.querySelector('h1')?.textContent).toBe('Your Training Data, Connected. One Dashboard. Every Activity in Context.');
    expect(hero.querySelector('.brand-name')?.textContent).toBe('Quantified Self.io');
    expect(hero.querySelector('app-public-feature-preview')).toBeNull();
    const training = fixture.nativeElement.querySelector('#home-training') as HTMLElement;
    expect(training.textContent).toContain('Sample data');
    expect(training.querySelector('.preview-placeholder--training')).toBeTruthy();
    expect(training.querySelector('app-training-summary-cards')).toBeNull();
    const [providerBlock, trainingBlock] = await fixture.getDeferBlocks();
    expect(providerBlock).toBeTruthy();
    await trainingBlock.render(DeferBlockState.Complete);
    fixture.detectChanges();
    expect(training.querySelector('app-training-summary-cards')).toBeTruthy();
    expect(training.querySelectorAll('app-training-metric-grid')).toHaveLength(2);
    expect(hero.querySelector('a[href="/login"]')?.textContent).toContain('Get Started Free');
    expect(hero.querySelector('a[href="/features/training-analysis"]')?.textContent).toContain('Explore Training Analysis');
    expect(fixture.nativeElement.textContent).not.toMatch(/explore the demo|try the demo/i);
    expect(selection).not.toHaveBeenCalled();
  });

  it('links only to existing public discovery, membership and onboarding destinations', () => {
    const paths = Array.from(fixture.nativeElement.querySelectorAll('a[href]'))
      .map((link: Element) => link.getAttribute('href')!);
    expect(paths.every(path => path === '/login' || path === '/integrations' || path === '/pricing'
      || path === '/help' || path === '/help#data-and-privacy'
      || fixture.componentInstance.features.some(feature => path === '#home-' + feature.id)
      || path.startsWith('/features/'))).toBe(true);
    expect(paths).not.toContain('/demo');
    expect(fixture.nativeElement.querySelector('nav[aria-label="Homepage features"]')).toBeTruthy();
  });

  it('exposes every supported provider logo and its name to assistive technology', () => {
    const logos = Array.from(fixture.nativeElement.querySelectorAll('.logos-container [role="img"]')) as HTMLElement[];
    expect(logos.map(logo => logo.getAttribute('aria-label'))).toEqual(['Garmin', 'Suunto', 'COROS', 'Wahoo']);
    expect(logos.every(logo => logo.getAttribute('aria-hidden') === 'false')).toBe(true);
  });

  it('retains every shared product visual and detailed feature section', () => {
    const sections = Array.from(fixture.nativeElement.querySelectorAll('.landing-page > section'))
      .map((section: Element) => section.className);
    expect(sections).toEqual(['hero-section', 'integrations-section', 'feature-section training-section',
      'feature-section workouts-section', 'feature-section training-plans-section', 'feature-section health-section',
      'feature-section ai-insights-section', 'feature-section footprint-section', 'feature-section analysis-section',
      'getting-started-section', 'membership-section', 'sovereignty-section', 'faq-section', 'final-cta-section']);
    const previews = fixture.debugElement.queryAll(By.directive(PublicFeaturePreviewComponent));
    expect(previews.map(preview => preview.componentInstance.previewKey()))
      .toEqual(['provider-flow', 'training-snapshot', 'training-readiness', 'training-signals',
        'training-explorer', 'dashboard', 'workout-analysis', 'training-plans',
        'health-sleep', 'health-hrv', 'health-weight', 'assistant-example', 'mcp-flow',
        'activity-map', 'reviewer-benchmark']);
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
    expect(copy).toContain('reference and test devices');
    expect(copy).toContain('location access remains separate');
    expect(fixture.nativeElement.querySelectorAll('.training-plans-section app-compact-row')).toHaveLength(6);
    expect(fixture.nativeElement.querySelector('#home-plans-example-title')?.textContent)
      .toContain("Create Today's Workout");
  });

  it('uses shared tier limits and clearly distinguishes free uploads from Pro connections', () => {
    const memberships = fixture.componentInstance.memberships;
    expect(memberships[0].features).toContain(`Up to ${USAGE_LIMITS.free} activities`);
    expect(memberships[0].features).toContain(`Up to ${ROUTE_USAGE_LIMITS.free} saved routes`);
    expect(memberships[1].features).toContain('Up to 1,000 activities');
    expect(memberships[1].features).toContain(`Up to ${ROUTE_USAGE_LIMITS.basic} saved routes`);
    expect(memberships[1].features).toContain(`Up to ${ASSISTANT_REQUEST_LIMITS.basic} Assistant requests per billing period`);
    expect(fixture.nativeElement.querySelectorAll('.membership-grid mat-card')).toHaveLength(3);
    expect(Array.from(fixture.nativeElement.querySelectorAll('.membership-grid h3'))
      .map((heading: Element) => heading.textContent)).toEqual(['Starter', 'Basic', 'Pro']);
    const steps = fixture.nativeElement.querySelector('.getting-started-steps');
    expect(steps.querySelectorAll('li')).toHaveLength(3);
    expect(steps.textContent).toContain('connect a supported provider with Pro');
    expect(fixture.nativeElement.querySelector('.membership-note').textContent).toContain('Paid prices');
  });

  it('opens and closes FAQ answers with one feedback owner and valid control targets', () => {
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
      const previews = Array.from(fixture.nativeElement.querySelectorAll('app-public-feature-preview'));
      const target = fixture.nativeElement.querySelector('#home-' + id) as HTMLElement;
      const scrollIntoView = vi.fn();
      target.scrollIntoView = scrollIntoView;
      fixture.nativeElement.querySelector(`.home-navigation a[href="#home-${id}"]`).click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
      expect(location.path(true)).toBe('/#home-' + id);
      expect(selection).toHaveBeenCalledOnce();
      expect(Array.from(fixture.nativeElement.querySelectorAll('app-public-feature-preview'))).toEqual(previews);
      expect(fixture.nativeElement.querySelectorAll('section[hidden]')).toHaveLength(0);
    },
  );

  it('restores direct section links, query parameters and browser history silently', () => {
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

  it('returns Back to the exact unanchored view and Forward to the point left within a feature', () => {
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
